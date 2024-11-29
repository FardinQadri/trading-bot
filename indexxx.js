const axios = require('axios');

// Function to fetch the open price for a given symbol and interval
async function getOpenPrice(symbol, interval) {
    try {
        const url = `https://fapi.binance.com/fapi/v1/klines`;
        const response = await axios.get(url, {
            params: {
                symbol: symbol,  // Symbol (e.g., 'BTCUSDT')
                interval: interval,  // Interval (e.g., '1h', '30m')
                limit: 1,  // Get only the most recent kline
            }
        });
        const openPrice = response.data[0][1];
        return { symbol, openPrice: parseFloat(openPrice) };
    } catch (error) {
        console.error(`Error fetching open price for ${symbol}:`, error);
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
        return { symbol, currentPrice: parseFloat(response.data.price) };
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
        return response.data.symbols
            .filter(symbol => symbol.contractType === 'PERPETUAL')  // Only perpetual futures
            .map(symbol => symbol.symbol);  // Extract symbol names
    } catch (error) {
        console.error('Error fetching futures symbols:', error);
        return [];
    }
}

// Function to compare prices and filter symbols with a 2% difference
async function comparePricesForAllSymbols(interval) {
    const symbols = await getFuturesSymbols();  // Get all futures symbols

    // Fetch both open and current prices concurrently using Promise.all
    const pricePromises = symbols.map(async (symbol) => {
        const openData = await getOpenPrice(symbol, interval);
        const currentData = await getCurrentPrice(symbol);

        if (openData && currentData) {
            const { openPrice } = openData;
            const { currentPrice } = currentData;
            const diff = Math.abs((currentPrice - openPrice) / openPrice) * 100;

            // Return data if the difference is greater than 2%
            if (diff > 2) {
                return {
                    symbol,
                    openPrice,
                    currentPrice,
                    percentageDifference: diff.toFixed(2)
                };
            }
        }
        return null;
    });

    // Wait for all price requests to complete
    const results = await Promise.all(pricePromises);

    // Filter out null results (symbols that didn't meet the criteria)
    const symbolsWithLargeDiff = results.filter(result => result !== null);

    // Print the symbols with more than 2% difference
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
