/**
 * ✅ Simple In-Memory Rate Limiter Middleware
 * Limits requests per IP to prevent abuse
 */

const rateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes default
    maxRequests = 100,          // 100 requests per window default
    message = 'Too many requests, please try again later.',
    skipSuccessfulRequests = false,
    keyGenerator = (req) => req.ip || req.connection.remoteAddress,
  } = options;

  // Store request counts per IP
  const requestCounts = new Map();

  // Cleanup old entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, data] of requestCounts.entries()) {
      if (now - data.startTime > windowMs) {
        requestCounts.delete(key);
      }
    }
  }, windowMs);

  return (req, res, next) => {
    const key = keyGenerator(req);
    const now = Date.now();

    if (!requestCounts.has(key)) {
      requestCounts.set(key, { count: 1, startTime: now });
      return next();
    }

    const data = requestCounts.get(key);

    // Reset if window has passed
    if (now - data.startTime > windowMs) {
      requestCounts.set(key, { count: 1, startTime: now });
      return next();
    }

    // Increment count
    data.count++;

    // Check if limit exceeded
    if (data.count > maxRequests) {
      return res.status(429).json({
        success: false,
        message,
        retryAfter: Math.ceil((data.startTime + windowMs - now) / 1000)
      });
    }

    next();
  };
};

// ✅ Stricter rate limiter for auth routes
const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 10,            // 10 login attempts
  message: 'Too many login attempts, please try again after 15 minutes.'
});

// ✅ Standard API rate limiter
const apiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  maxRequests: 200,           // 200 requests
  message: 'Too many requests, please slow down.'
});

// ✅ Strict rate limiter for sensitive operations
const strictRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  maxRequests: 20,            // 20 requests
  message: 'Rate limit exceeded for this operation.'
});

module.exports = {
  rateLimit,
  authRateLimit,
  apiRateLimit,
  strictRateLimit
};
