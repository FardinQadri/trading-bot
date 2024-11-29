const axios = require('axios');

// Function to fetch the open price for a given symbol and interval
async function getOpenPrice(symbol, interval) {
    try {
        // Construct the Binance API URL for futures market
        const url = `https://fapi.binance.com/fapi/v1/klines`;
        
        // Send a GET request to fetch the klines data
        const response = await axios.get(url, {
            params: {
                symbol: symbol,  // Symbol (e.g., 'BTCUSDT')
                interval: interval,  // Interval (e.g., '1h', '30m')
                limit: 1,  // Get only the most recent kline
            }
        });
        
        // Extract the open price from the response data (first kline)
        const openPrice = response.data[0][1];
        return { symbol, openPrice };
    } catch (error) {
        console.error(`Error fetching data for ${symbol}:`, error);
        return null;
    }
}

// Function to fetch the current price for a given symbol
async function getCurrentPrice(symbol) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/ticker/price`;
        const response = await axios.get(url, {
            params: {
                symbol: symbol,  // Symbol (e.g., 'BTCUSDT')
            }
        });
        
        const currentPrice = parseFloat(response.data.price);
        return { symbol, currentPrice };
    } catch (error) {
        console.error(`Error fetching current price for ${symbol}:`, error);
        return null;
    }
}

// Function to fetch the list of all Binance Futures symbols
async function getFuturesSymbols() {
    try {
        const url = `https://fapi.binance.com/fapi/v1/exchangeInfo`;
        const response = await axios.get(url);
        const symbols = response.data.symbols
            .filter(symbol => symbol.contractType === 'PERPETUAL')  // Only perpetual futures
            .map(symbol => symbol.symbol);  // Extract symbol names
        return symbols;
    } catch (error) {
        console.error('Error fetching futures symbols:', error);
        return [];
    }
}

// Function to compare prices and print symbols with a 2% difference
async function comparePricesForAllSymbols(interval) {
    const symbols = await getFuturesSymbols();  // Get all futures symbols
    const symbolsWithLargeDiff = [];

    for (const symbol of symbols) {
        // Fetch open price for each symbol
        const openData = await getOpenPrice(symbol, interval);
        if (!openData) continue;

        // Fetch current price for each symbol
        const currentData = await getCurrentPrice(symbol);
        if (!currentData) continue;

        // Calculate percentage difference
        const openPrice = parseFloat(openData.openPrice);
        const currentPrice = currentData.currentPrice;
        const diff = Math.abs((currentPrice - openPrice) / openPrice) * 100;

        // If the difference is more than 2%, store the symbol
        if (diff > 2) {
            symbolsWithLargeDiff.push({
                symbol: symbol,
                openPrice: openPrice,
                currentPrice: currentPrice,
                percentageDifference: diff.toFixed(2)
            });
        }
    }

    // Print the symbols that have a difference greater than 2%
    if (symbolsWithLargeDiff.length > 0) {
        console.log('Symbols with more than 2% difference between open and current price:');
        console.table(symbolsWithLargeDiff);
    } else {
        console.log('No symbols found with more than 2% price difference.');
    }
}

// Example usage:
const interval = '1h';  // Set the interval (e.g., '1h', '30m', '4h', etc.)
comparePricesForAllSymbols(interval);
