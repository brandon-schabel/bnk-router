import {
    ValidationSchema,
    ValidationErrorItem,
    ValidationFailedError,
    ValidatedData,
    RouterValidator
} from "./router-types";

/**
 * Attempts to match a request path to a route path with parameters.
 * Returns an object of { paramName: value } if matched, otherwise null.
 */
export function matchRoute(
    path: string,
    routePath: string
): Record<string, string> | null {
    const pathWithoutQuery = path.split("?")[0];
    const cleanPath = pathWithoutQuery.replace(/\/+$/, "");
    const cleanRoutePath = routePath.replace(/\/+$/, "");

    if (cleanPath === "" && cleanRoutePath === "") {
        return {};
    }

    const pathParts = cleanPath.split("/").filter(Boolean);
    const routeParts = cleanRoutePath.split("/").filter(Boolean);

    if (pathParts.length !== routeParts.length) {
        return null;
    }

    const params: Record<string, string> = {};

    for (let i = 0; i < routeParts.length; i++) {
        const routePart = routeParts[i];
        const pathPart = pathParts[i];

        if (routePart.startsWith(":")) {
            params[routePart.slice(1)] = pathPart;
        } else if (routePart !== pathPart) {
            return null;
        }
    }

    return params;
}

function callValidator<T>(validator: RouterValidator<T>, input: unknown): T {
    if (typeof validator === "function") {
        return validator(input);
    }
    if (validator && typeof validator.parse === "function") {
        return validator.parse(input);
    }
    throw new Error("Invalid validator - must be function or object with parse method");
}

/**
 * Validates the request using the provided ValidationSchema.
 * If any part fails, we accumulate the errors and throw a ValidationFailedError.
 */
export async function validateRequest<
    V extends ValidationSchema | undefined
>(
    req: Request,
    params: Record<string, string>,
    validation?: V
): Promise<ValidatedData<V>> {
    const parsedData: any = {
        params,
        query: {},
        headers: {},
        body: undefined,
    };
    const errors: ValidationErrorItem[] = [];

    // Validate params
    if (validation?.params) {
        try {
            parsedData.params = callValidator(validation.params, params);
        } catch (err) {
            errors.push({
                type: "params",
                messages: [err instanceof Error ? err.message : String(err)],
            });
        }
    }

    // Validate query
    if (validation?.query) {
        const url = new URL(req.url);
        const queryEntries = Object.fromEntries(url.searchParams.entries());
        try {
            parsedData.query = callValidator(validation.query, queryEntries);
        } catch (err) {
            errors.push({
                type: "query",
                messages: [err instanceof Error ? err.message : String(err)],
            });
        }
    } else {
        parsedData.query = Object.fromEntries(new URL(req.url).searchParams.entries());
    }

    // Validate headers
    if (validation?.headers) {
        const hdrs: Record<string, string> = {};
        req.headers.forEach((value, key) => {
            hdrs[key] = value;
        });
        try {
            parsedData.headers = callValidator(validation.headers, hdrs);
        } catch (err) {
            errors.push({
                type: "headers",
                messages: [err instanceof Error ? err.message : String(err)],
            });
        }
    } else {
        const hdrs: Record<string, string> = {};
        req.headers.forEach((value, key) => {
            hdrs[key] = value;
        });
        parsedData.headers = hdrs;
    }

    // Validate body
    if (validation?.body) {
        try {
            const contentType = req.headers.get("content-type") || "";
            let bodyData: unknown;

            if (contentType.includes("application/json")) {
                try {
                    bodyData = await req.clone().json();
                } catch (err) {
                    errors.push({
                        type: "body",
                        messages: ["Invalid JSON in request body"],
                    });
                    throw new ValidationFailedError(errors);
                }
            } else {
                bodyData = await req.clone().text();
            }

            try {
                parsedData.body = callValidator(validation.body, bodyData);
            } catch (err) {
                errors.push({
                    type: "body",
                    messages: [err instanceof Error ? err.message : String(err)],
                });
            }
        } catch (err) {
            if (!errors.some(e => e.type === "body")) {
                errors.push({
                    type: "body",
                    messages: [err instanceof Error ? err.message : String(err)],
                });
            }
        }
    }

    if (errors.length > 0) {
        throw new ValidationFailedError(errors);
    }

    return parsedData;
}

/**
 * Helper to convert any thrown error into a string message.
 */
function extractErrorMessage(err: unknown): string {
    if (err instanceof Error) {
        return err.message;
    }
    if (typeof err === "string") {
        return err;
    }
    return "Unknown validation error";
}

