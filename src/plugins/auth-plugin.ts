import {
    RouterPlugin,
    RouteConfig,
    RouteHandler,
    ValidationSchema,
} from '../router-types';
import { Router } from '../router';
import { HttpMethod } from '@bnk/cors';
import { ValidationFailedError } from '../router-types';


// Auth Types
export type AuthData = {
    userId: string;
    roles?: string[];
    [key: string]: unknown;
  };
  
  export interface AuthConfig {
    verify: (req: Request) => Promise<AuthData>;
    onError?: (error: Error) => Response;
  }
  
export interface RouteConfigWithAuth<V extends ValidationSchema | undefined, T> extends RouteConfig<V, T> {
    auth?: boolean;
}

/**
 * Simple AuthPlugin that:
 * 1. Keeps a global AuthConfig if desired
 * 2. Checks if `opts.auth` is truthy when registering routes
 * 3. If so, wraps the route's handler with authentication logic
 */
export class AuthPlugin<A extends AuthData = AuthData> implements RouterPlugin {
    name = 'auth-plugin';

    /**
     * Optional global auth config. Routes can override this
     * by providing a per-route auth config object in RouteConfig.
     */
    private globalAuthConfig?: AuthConfig;

    constructor(globalAuthConfig?: AuthConfig) {
        this.globalAuthConfig = globalAuthConfig;
    }

    /**
     * Optional method to update the global auth config at runtime.
     */
    configureAuth(config: AuthConfig) {
        this.globalAuthConfig = config;
    }

    /**
     * Extend the plugin API so we can return updated opts & handler in `onBeforeRouteRegister`
     */
    async onBeforeRouteRegister?(
        router: Router,
        method: HttpMethod,
        path: string,
        opts: RouteConfigWithAuth<any, any>,
        handler: RouteHandler<any, any>
    ): Promise<{
        opts?: RouteConfigWithAuth<any, any>;
        handler?: RouteHandler<any, any>;
    }> {
        // Skip if auth is not required
        if (!opts.auth) {
            return {};
        }

        // Prepare a wrapped handler that performs authentication + validation
        const wrappedHandler: RouteHandler<any, any> = async (req, validatedData) => {
            // 1) Determine which AuthConfig to use (route-level vs global)
            const routeAuth = this.globalAuthConfig;
            if (!routeAuth) {
                // If user said `auth: true` but we have no config, fail
                return new Response(
                    JSON.stringify({
                        error: 'Authentication configuration error',
                        message: 'Authentication is required but no auth config is available',
                    }),
                    { status: 500, headers: { 'Content-Type': 'application/json' } }
                );
            }

            // 2) Attempt to verify user
            try {
                const userAuthData = await routeAuth.verify(req);
                (req as any).auth = userAuthData; // attach user info to request
            } catch (error) {
                // If verification fails, see if there's a route-level or global onError
                if (routeAuth.onError) {
                    return routeAuth.onError(error as Error);
                }
                return new Response(
                    JSON.stringify({ error: 'Authentication failed', message: String(error) }),
                    { status: 401, headers: { 'Content-Type': 'application/json' } }
                );
            }

            // 3) Re-validate request with updated `req.auth` if necessary
            try {
                // Merge the validated data with auth
                const finalData = { ...validatedData, auth: (req as any).auth };
                return handler(req, finalData);
            } catch (err) {
                if (err instanceof ValidationFailedError) {
                    const details = err.errors.map(e => ({
                        type: e.type,
                        messages: e.messages,
                    }));
                    return new Response(
                        JSON.stringify({ error: 'Validation failed', details }),
                        {
                            status: 400,
                            headers: { 'Content-Type': 'application/json' },
                        }
                    );
                }
                // Otherwise, rethrow to be handled by onError
                throw err;
            }
        };

        // Return updated config and wrapped handler
        return {
            opts,
            handler: wrappedHandler,
        };
    }
}