const axios = require("axios");
const WebSocket = require("ws");

// Configuration
const leverage = 10;
const maxLossPercent = 0.001; // Max 1% portfolio risk
const profitTargetPercent = 0.001; // Target 1% profit (10% considering leverage)
let trailingStopPercent = 0.001; // 1% trailing stop without leverage
let portfolio = 10; // Starting portfolio. once the price goes above tp, the tp should become new sl and new tp should be 1% above without leverage. it should happen recursively and it should only exit when a sl is hit
let currentTrade = null; // Holds details of the active trade
let interval = "1s"; // Default interval
const cooldownDuration = 300000; // 1-minute cooldown
const cooldownCoins = new Set(); // Track coins on cooldown

// Function to fetch initial open prices for USDT pairs
async function getKlineOpenPrices() {
    try {
        const tickersUrl = "https://api.binance.com/api/v3/ticker/price";
        const { data: tickers } = await axios.get(tickersUrl);

        // Get all USDT pairs
        const usdtPairs = tickers
            .filter((ticker) => ticker.symbol.endsWith("USDT"))
            .map((ticker) => ticker.symbol);

        const openPrices = {};

        // Fetch the latest kline for each pair
        for (const symbol of usdtPairs) {
            const klineUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1`;
            try {
                const { data: kline } = await axios.get(klineUrl);
                openPrices[symbol] = parseFloat(kline[0][1]); // Open price of the current candle
            } catch (error) {
                console.error(`Error fetching kline for ${symbol}:`, error.message);
            }
        }

        return openPrices;
    } catch (error) {
        console.error("Error fetching initial open prices:", error.message);
        throw error;
    }
}

// Function to calculate RSI
async function calculateRSI(symbol) {
    try {
        const rsiUrl = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=15m&limit=14`;
        const { data: klines } = await axios.get(rsiUrl);

        const closes = klines.map((k) => parseFloat(k[4]));
        const gains = [];
        const losses = [];

        for (let i = 1; i < closes.length; i++) {
            const change = closes[i] - closes[i - 1];
            if (change > 0) {
                gains.push(change);
            } else {
                losses.push(-change);
            }
        }

        const avgGain = gains.reduce((a, b) => a + b, 0) / gains.length || 0;
        const avgLoss = losses.reduce((a, b) => a + b, 0) / losses.length || 0;
        const rs = avgLoss === 0 ? avgGain : avgGain / avgLoss;
        const rsi = 100 - 100 / (1 + rs);

        return rsi;
    } catch (error) {
        console.error(`Error calculating RSI for ${symbol}:`, error.message);
        return null; // If error, return null to skip RSI filtering
    }
}

// Function to start WebSocket stream
function startWebSocket(openPrices) {
    const ws = new WebSocket("wss://stream.binance.com:9443/ws/!miniTicker@arr");

    ws.on("message", async (data) => {
        try {
            const tickers = JSON.parse(data);

            // Skip processing if there's an active trade
            if (currentTrade) return;

            // Filter for USDT pairs not on cooldown
            const usdtPairs = tickers.filter(
                (ticker) => ticker.s.endsWith("USDT") && !cooldownCoins.has(ticker.s)
            );

            let bestTrade = null;

            for (const ticker of usdtPairs) {
                const symbol = ticker.s;
                const currentPrice = parseFloat(ticker.c);

                if (openPrices[symbol]) {
                    const openPrice = openPrices[symbol];
                    const priceChangePercent =
                        ((currentPrice - openPrice) / openPrice) * 100;

                    if (Math.abs(priceChangePercent) > 2) {
                        const rsi = await calculateRSI(symbol);
                        if (rsi !== null) {
                            if (priceChangePercent > 0 && rsi >= 70) {
                                console.log(`Skipping long for ${symbol}: RSI ${rsi} (overbought)`);
                                continue;
                            }
                            if (priceChangePercent < 0 && rsi <= 30) {
                                console.log(`Skipping short for ${symbol}: RSI ${rsi} (oversold)`);
                                continue;
                            }
                        }

                        if (
                            !bestTrade ||
                            Math.abs(priceChangePercent) < Math.abs(bestTrade.priceChangePercent)
                        ) {
                            bestTrade = {
                                symbol,
                                currentPrice,
                                priceChangePercent,
                                direction: priceChangePercent > 0 ? "long" : "short",
                            };
                        }
                    }
                }
            }

            if (bestTrade) handleTradeEntry(bestTrade);

            if (portfolio > 10000 || portfolio <= 0) {
                console.log("Portfolio limit reached. Stopping bot.");
                ws.close();
            }
        } catch (error) {
            console.error("Error processing WebSocket message:", error.message);
        }
    });

    ws.on("close", () => {
        console.log("WebSocket connection closed.");
    });
}

// Function to handle trade entry
function handleTradeEntry(ticker) {
    if (currentTrade) return;

    const { symbol, currentPrice, priceChangePercent, direction } = ticker;
    const riskAmount = portfolio;

    const positionSize = riskAmount / currentPrice;
    if (positionSize <= 0) return;

    currentTrade = {
        symbol,
        entryPrice: currentPrice,
        positionSize,
        direction,
        trailingStopPrice: null,
        timeoutId: null,
    };

    console.log(`Entering ${direction} position for ${symbol} at ${currentPrice.toFixed(2)}`);

    monitorTrade(currentTrade);

    currentTrade.timeoutId = setTimeout(() => {
        if (currentTrade && currentTrade.symbol === symbol) {
            console.log(`Force-closing trade for ${symbol} due to timeout.`);
            exitTrade(currentTrade, currentPrice, "timeout");
        }
    }, 180000);
}

// Function to monitor the trade
async function monitorTrade(trade) {
    let targetPrice =
        trade.direction === "long"
            ? trade.entryPrice * (1 + profitTargetPercent)
            : trade.entryPrice * (1 - profitTargetPercent);
    let stopLossPrice =
        trade.direction === "long"
            ? trade.entryPrice * (1 - maxLossPercent)
            : trade.entryPrice * (1 + maxLossPercent);

    trade.trailingStopPrice = stopLossPrice;

    while (currentTrade && currentTrade.symbol === trade.symbol) {
        try {
            const { data: tickerData } = await axios.get(
                `https://api.binance.com/api/v3/ticker/price?symbol=${trade.symbol}`
            );
            const currentPrice = parseFloat(tickerData.price);

            console.log(`Monitoring ${trade.symbol}: Current Price: ${currentPrice.toFixed(2)}`);

            // Check if the price is above the current target price
            if (
                (trade.direction === "long" && currentPrice >= targetPrice) ||
                (trade.direction === "short" && currentPrice <= targetPrice)
            ) {
                // Update the target price by 1% for long positions (or down by 1% for short positions)
                targetPrice = trade.direction === "long" 
                    ? targetPrice * 1.01 
                    : targetPrice * 0.99;

                // Set the stop loss (SL) to the previous target price
                stopLossPrice = targetPrice;

                console.log(`${trade.symbol} reached target. Updating TP to ${targetPrice.toFixed(2)} and SL to ${stopLossPrice.toFixed(2)}.`);
            }

            // Exit if the price hits the stop loss (SL)
            if (
                (trade.direction === "long" && currentPrice <= stopLossPrice) ||
                (trade.direction === "short" && currentPrice >= stopLossPrice)
            ) {
                exitTrade(trade, currentPrice, "trailing_stop");
                break;
            }

            await new Promise((resolve) => setTimeout(resolve, 10000)); // Delay for next check
        } catch (error) {
            console.error(`Error monitoring trade for ${trade.symbol}:`, error.message);
        }
    }
}

// Function to exit the trade
function exitTrade(trade, exitPrice, outcome) {
    if (currentTrade !== trade) return;

    let profitOrLoss = 0;

    if (trade.direction === "long") {
        profitOrLoss =
            (exitPrice - trade.entryPrice) * trade.positionSize * leverage;
    } else if (trade.direction === "short") {
        profitOrLoss =
            (trade.entryPrice - exitPrice) * trade.positionSize * leverage;
    }

    portfolio += profitOrLoss;

    console.log(`${outcome} for ${trade.symbol}: Exit Price: ${exitPrice.toFixed(2)}, Amount: $${profitOrLoss.toFixed(2)}`);
    console.log(`Current Portfolio: $${portfolio.toFixed(2)}`);

    if (trade.timeoutId) clearTimeout(trade.timeoutId);

    // Add to cooldown
    cooldownCoins.add(trade.symbol);
    setTimeout(() => cooldownCoins.delete(trade.symbol), cooldownDuration);

    currentTrade = null;
}

// Main execution
(async function startBot() {
    try {
        const openPrices = await getKlineOpenPrices();
        startWebSocket(openPrices);
    } catch (error) {
        console.error("Error starting bot:", error.message);
    }
})();
