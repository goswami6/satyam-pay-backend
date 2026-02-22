const User = require("../models/user.model");

/**
 * API Authentication Middleware
 * 
 * Validates API requests using HTTP Basic Authentication
 * - Username: Key ID (sat_test_xxx or sat_live_xxx)
 * - Password: Secret Key
 * 
 * Usage:
 * curl -u sat_test_YOUR_KEY_ID:YOUR_SECRET_KEY https://api.example.com/v1/orders
 * 
 * Or with Authorization header:
 * Authorization: Basic base64(key_id:secret_key)
 */

const apiAuthMiddleware = async (req, res, next) => {
  try {
    // Get Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Basic ")) {
      return res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          description: "API key is required. Use HTTP Basic Auth with Key ID as username and Secret Key as password.",
          source: "api",
          metadata: {}
        }
      });
    }

    // Decode Basic Auth credentials
    const base64Credentials = authHeader.split(" ")[1];
    const credentials = Buffer.from(base64Credentials, "base64").toString("utf8");
    const [keyId, secretKey] = credentials.split(":");

    if (!keyId || !secretKey) {
      return res.status(401).json({
        error: {
          code: "BAD_REQUEST_ERROR",
          description: "Invalid API credentials format. Both Key ID and Secret Key are required.",
          source: "api",
          metadata: {}
        }
      });
    }

    // Validate key format
    if (!keyId.startsWith("sat_test_") && !keyId.startsWith("sat_live_")) {
      return res.status(401).json({
        error: {
          code: "BAD_REQUEST_ERROR",
          description: "Invalid Key ID format. Key ID should start with sat_test_ or sat_live_",
          source: "api",
          metadata: {}
        }
      });
    }

    // Find user with this API key
    const user = await User.findOne({
      "apiTokens.keyId": keyId,
      "apiTokens.secretKey": secretKey,
      "apiTokens.status": "active"
    });

    if (!user) {
      return res.status(401).json({
        error: {
          code: "BAD_REQUEST_ERROR",
          description: "Authentication failed. Invalid Key ID or Secret Key.",
          source: "api",
          metadata: {}
        }
      });
    }

    // Find the specific token
    const token = user.apiTokens.find(
      (t) => t.keyId === keyId && t.secretKey === secretKey && t.status === "active"
    );

    if (!token) {
      return res.status(401).json({
        error: {
          code: "BAD_REQUEST_ERROR",
          description: "API key has been revoked or is inactive.",
          source: "api",
          metadata: {}
        }
      });
    }

    // Check mode mismatch (live key in test mode or vice versa)
    const isLiveKey = keyId.startsWith("sat_live_");
    const isLiveMode = process.env.PAYMENT_MODE === "live";

    // Attach user and token info to request
    req.apiUser = {
      userId: user._id,
      email: user.email,
      name: user.name,
      keyId: token.keyId,
      mode: token.mode,
      isLiveMode: isLiveKey
    };

    // Update last used timestamp
    token.lastUsed = new Date();
    await user.save();

    next();
  } catch (error) {
    console.error("API Auth Error:", error);
    return res.status(500).json({
      error: {
        code: "SERVER_ERROR",
        description: "Internal server error during authentication.",
        source: "internal",
        metadata: {}
      }
    });
  }
};

module.exports = apiAuthMiddleware;
