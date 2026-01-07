// src/utils/response.ts
export function jsonResponse(data: any, status: number = 200, headers: HeadersInit = {}): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
    });
}

export function errorResponse(message: string, status: number = 400): Response {
    return jsonResponse({ error: message }, status);
}

export function successResponse(data: any = {}, message?: string): Response {
    const response = message ? { success: true, message, ...data } : { success: true, ...data };
    return jsonResponse(response);
}
