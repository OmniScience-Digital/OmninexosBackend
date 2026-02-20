import { createXeroQuote } from "../services/xero.quote.service.js";
export const xeroQuoteController = {
    createQuote: async (req, res) => {
        try {
            const quoteData = req.body; // JSON from React
            const result = await createXeroQuote(quoteData);
            res.status(200).json({
                success: true,
                data: result,
            });
        }
        catch (error) {
            console.error("Error creating Xero quote:", error);
            res.status(500).json({
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    },
};
