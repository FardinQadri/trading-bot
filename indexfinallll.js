const axios = require('axios');
const WebSocket = require('ws');

// Configuration
const leverage = 10;
const maxLossPercent = 0.01; // Max 1% portfolio risk
const profitTargetPercent = 0.01; // Target 1% profit (10% considering leverage)
let portfolio = 1000; // Starting portfolio
let currentTrade = null; // Holds details of the active trade
const interval = '30m'; // Binance's interval

// Function to fetch initial open prices for USDT pairs
async function getKlineOpenPrices() {
    const tickersUrl = 'https://api.binance.com/api/v3/ticker/price';
    const { data: tickers } = await axios.get(tickersUrl);

    // Get all USDT pairs
    const usdtPairs = tickers
        .filter(ticker => ticker.symbol.endsWith('USDT'))
        .map(ticker => ticker.symbol);

    const openPrices = {};

    // Fetch the latest 30m kline for each pair
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
}

// Function to start WebSocket stream
function startWebSocket(openPrices) {
    const ws = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');

    ws.on('message', async (data) => {
        try {
            const tickers = JSON.parse(data);

            // Skip processing if there's an active trade
            if (currentTrade) return;

            // Filter for USDT pairs
            const usdtPairs = tickers.filter(ticker => ticker.s.endsWith('USDT'));

            let bestTrade = null;

            for (const ticker of usdtPairs) {
                const symbol = ticker.s;
                const currentPrice = parseFloat(ticker.c);

                if (openPrices[symbol]) {
                    const openPrice = openPrices[symbol];
                    const priceChangePercent = ((currentPrice - openPrice) / openPrice) * 100;

                    // Find the coin with the largest change over 2%
                    if (Math.abs(priceChangePercent) > 2) {
                        console.log(
                            `Symbol: ${symbol}, Open Price: ${openPrice}, Current Price: ${currentPrice}, Change: ${priceChangePercent.toFixed(2)}%`
                        );

                        if (
                            !bestTrade ||
                            Math.abs(priceChangePercent) > Math.abs(bestTrade.priceChangePercent)
                        ) {
                            bestTrade = {
                                symbol,
                                currentPrice,
                                priceChangePercent,
                                direction: priceChangePercent > 0 ? 'long' : 'short',
                            };
                        }
                    }
                }
            }

            // Enter a trade if a valid opportunity is found
            if (bestTrade) handleTradeEntry(bestTrade);

            // Stop trading if portfolio hits thresholds
            if (portfolio > 10000) {
                console.log("Portfolio exceeded $10,000. Stopping trading.");
                ws.close();
            } else if (portfolio <= 0) {
                console.log("Portfolio reached $0 or below. Stopping trading.");
                ws.close();
            }
        } catch (error) {
            console.error("Error processing WebSocket message:", error);
        }
    });

    ws.on('close', () => {
        console.log('WebSocket connection closed.');
    });
}

// Function to handle trade entry (ensuring only one trade per interval)
function handleTradeEntry(ticker) {
    if (currentTrade) return; // Skip trade if there's already an active trade

    const { symbol, currentPrice, priceChangePercent, direction } = ticker;
    const riskAmount = portfolio * maxLossPercent;

    // Calculate position size
    const positionSize = (riskAmount * leverage) / currentPrice;
    if (positionSize <= 0) return;

    currentTrade = {
        symbol,
        entryPrice: currentPrice,
        positionSize,
        direction,
    };

    console.log(
        `Entering ${direction} position for ${symbol} at ${currentPrice.toFixed(2)}, Position Size: ${positionSize.toFixed(2)}`
    );

    // Simulate trade exit after a set period (5 seconds for example)
    simulateTradeExit(currentTrade);
}

// Function to simulate trade exit after a set period
function simulateTradeExit(trade) {
    setTimeout(() => {
        const exitPrice =
            trade.direction === 'long'
                ? trade.entryPrice * (1 + profitTargetPercent)
                : trade.entryPrice * (1 - profitTargetPercent);

        const profit =
            trade.direction === 'long'
                ? (exitPrice - trade.entryPrice) * trade.positionSize
                : (trade.entryPrice - exitPrice) * trade.positionSize;

        portfolio += profit;

        console.log(
            `Exiting ${trade.direction} position for ${trade.symbol} at ${exitPrice.toFixed(
                2
            )}, ${profit >= 0 ? 'Profit' : 'Loss'}: $${profit.toFixed(2)}`
        );

        console.log(`Current Portfolio: $${portfolio.toFixed(2)}`);
        currentTrade = null; // Trade is now closed
    }, 5000); // Simulate exit after 5 seconds
}

// Start the bot
(async () => {
    console.log('Fetching initial open prices...');
    const openPrices = await getKlineOpenPrices();
    console.log('Starting WebSocket...');
    startWebSocket(openPrices);
})();
