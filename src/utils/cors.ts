// src/utils/cors.ts
export function getCorsHeaders(origin: string, allowedOrigins: string[]): HeadersInit {
    const headers: HeadersInit = {
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
    };

    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Credentials'] = 'true';
    }

    return headers;
}

export function handleCorsPreflightRequest(
    request: Request,
    allowedOrigins: string[]
): Response | null {
    if (request.method === 'OPTIONS') {
        const origin = request.headers.get('Origin') || '';
        return new Response(null, {
            status: 204,
            headers: getCorsHeaders(origin, allowedOrigins),
        });
    }
    return null;
}
