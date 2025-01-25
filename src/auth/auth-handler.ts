import {
  AuthConfig,
  AuthData,
  AuthMiddlewareConfig,
  RequestWithData,
  RouteHandler,
  ValidationSchema
} from '../router-types';
import { validateRequest, } from '../router-utils';
import { ValidationFailedError } from '../router-types';

export class AuthHandler {
  private config?: AuthConfig;

  constructor(config?: AuthConfig) {
    this.config = config;
  }

  configure(config: AuthConfig) {
    this.config = config;
  }

  async handleAuth<A = AuthData, T = unknown>(
    req: RequestWithData<T>,
    authConfig: boolean | AuthMiddlewareConfig<A> | undefined
  ): Promise<{ response: Response | null; authData: A | null }> {
    // Skip auth if not required
    if (!authConfig) {
      return { response: null, authData: null };
    }

    // Check if auth config exists
    if (!this.config) {
      return {
        response: new Response(
          JSON.stringify({
            error: 'Authentication configuration error',
            message: 'Authentication is required but no auth config was provided'
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        ),
        authData: null
      };
    }

    try {
      // Use route-specific verify if provided, otherwise use global
      const verifyFn = typeof authConfig === 'object' ? authConfig.verify : this.config.verify;
      const authData = await verifyFn(req);
      return { response: null, authData: authData as A };
    } catch (error) {
      // Use route-specific error handler if provided, otherwise use global
      const errorHandler =
        typeof authConfig === 'object'
          ? authConfig.onError || this.config.onError
          : this.config.onError;

      const err = error instanceof Error ? error : new Error(String(error));

      return {
        response: errorHandler
          ? errorHandler(err)
          : new Response(
              JSON.stringify({ error: 'Authentication failed', message: err.message }),
              { status: 401, headers: { 'Content-Type': 'application/json' } }
            ),
        authData: null
      };
    }
  }

  async authenticateRequest<T = unknown, A extends AuthData = AuthData>(
    req: RequestWithData<T>,
    authConfig: AuthMiddlewareConfig<A>,
    params: Record<string, string>,
    validation: ValidationSchema | undefined,
    handler: RouteHandler<typeof validation, A, T>
  ): Promise<Response> {
    // Create temporary auth handler with route-specific config
    const tempHandler = new AuthHandler({
      ...authConfig,
      verify: async (request) => authConfig.verify(request)
    });

    // Handle authentication
    const { response: authResponse, authData } = await tempHandler.handleAuth(req, true);
    if (authResponse) return authResponse;

    // Clone & attach auth
    const authedReq = Object.assign(req.clone(), { auth: authData }) as RequestWithData<T>;

    try {
      // Validate and handle request
      const parsedData = await validateRequest(req, params, validation);
      return await handler(authedReq, parsedData);
    } catch (error) {
      if (error instanceof ValidationFailedError) {
        return new Response(
          JSON.stringify({
            error: 'Validation failed',
            details: error.errors.map(err => ({
              type: err.type,
              messages: err.messages
            }))
          }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
      throw error;
    }
  }
} 