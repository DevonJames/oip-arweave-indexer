/**
 * Clean API Call Logger
 * Logs only API calls with timestamp and parameters
 */

function apiLogger(req, res, next) {
    // Skip health check spam unless it's the main health endpoint
    if (req.path.includes('/health') && req.path !== '/api/health') {
        return next();
    }

    const timestamp = new Date().toISOString();
    const method = req.method;
    const path = req.path;
    const query = Object.keys(req.query).length > 0 ? req.query : null;
    const body = req.body && Object.keys(req.body).length > 0 ? '(body present)' : null;
    const auth = req.headers.authorization ? '(authenticated)' : '(public)';

    // Format parameters for clean logging
    const params = [];
    if (query) {
        const cleanQuery = { ...query };
        // Truncate long values for readability
        Object.keys(cleanQuery).forEach(key => {
            if (typeof cleanQuery[key] === 'string' && cleanQuery[key].length > 100) {
                cleanQuery[key] = cleanQuery[key].substring(0, 100) + '...';
            }
        });
        params.push(`query=${JSON.stringify(cleanQuery)}`);
    }
    if (body) params.push(body);

    const paramsStr = params.length > 0 ? ` | ${params.join(' | ')}` : '';

    console.log(`[${timestamp}] ${method} ${path} ${auth}${paramsStr}`);

    next();
}

module.exports = apiLogger;

