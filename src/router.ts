import { matchRoute, validateRequest } from "./router-utils";
import { ValidationFailedError } from "./router-types";
import {
  RouteHandler,
  Middleware,
  RouteConfig,
  RouterOptions,
  Route,
  ValidationSchema,
  RequestWithData,
  RouterPlugin,
  PluginHookFunction,
} from "./router-types";
import { HttpMethod } from "@bnk/cors";

export class Router {
  private routes: Route<any>[] = [];
  private globalMws: Middleware<any>[] = [];
  private pathMws: Map<string, Middleware<any>[]> = new Map();

  private plugins: RouterPlugin[] = [];
  private onError?: (error: unknown, req: Request) => Response;

  constructor(opts?: RouterOptions) {
    if (opts?.onError) {
      this.onError = opts.onError;
    }
  }

  /** Plugin registration remains the same. */
  async registerPlugin(plugin: RouterPlugin): Promise<void> {
    this.plugins.push(plugin);
    await plugin.onInit?.(this);
  }

  private async runPluginHook<T extends keyof RouterPlugin>(
    hookName: T,
    ...args: Parameters<Extract<RouterPlugin[T], PluginHookFunction>>
  ): Promise<Response | null> {
    for (const plugin of this.plugins) {
      const hook = plugin[hookName];
      if (hook) {
        const result = await (hook as Function).apply(plugin, args);
        if (result instanceof Response) return result;
      }
    }
    return null;
  }

  /** Attach a middleware globally or for a specific path. */
  use(mw: Middleware<any>, path?: string) {
    if (path) {
      const arr = this.pathMws.get(path) || [];
      arr.push(mw);
      this.pathMws.set(path, arr);
    } else {
      this.globalMws.push(mw);
    }
  }

  /**
   * Generic method that registers any route (method + path).
   * UPDATED: now we explicitly iterate over plugins that implement onBeforeRouteRegister 
   * and merge in returned opts/handler.
   */
  async addRoute<V extends ValidationSchema | undefined, T = unknown>(
    method: HttpMethod,
    path: string,
    opts: RouteConfig<V, T>,
    handler: RouteHandler<V, T>
  ): Promise<void> {
    // Let plugins modify opts/handler before we register the route.
    let finalOpts = opts;
    let finalHandler = handler;

    for (const plugin of this.plugins) {
      if (plugin.onBeforeRouteRegister) {
        const result = await plugin.onBeforeRouteRegister(this, method, path, finalOpts, finalHandler);
        if (result) {
          if (result.opts) {
            finalOpts = result.opts;
          }
          if (result.handler) {
            finalHandler = result.handler;
          }
        }
      }
    }

    // We'll wrap the final handler so we can run validation before calling it.
    const wrapped = (req: Request, params: Record<string, string>) =>
      this.runValidationAndHandle(req as RequestWithData<T>, params, finalOpts, finalHandler);

    this.routes.push({ path, method, handler: wrapped, middleware: finalOpts.middleware });

    // Allow plugins to do any post-route registration logic
    await this.runPluginHook("onAfterRouteRegister", this, method, path, finalOpts);
  }

  /**
   * GET route
   */
  async get<V extends ValidationSchema | undefined, T = unknown>(
    path: string,
    opts: RouteConfig<V, T>,
    handler: RouteHandler<V, T>
  ) {
    await this.addRoute("GET", path, opts, handler);
  }

  async post<V extends ValidationSchema | undefined, T = unknown>(
    path: string,
    opts: RouteConfig<V, T>,
    handler: RouteHandler<V, T>
  ) {
    await this.addRoute("POST", path, opts, handler);
  }

  async put<V extends ValidationSchema | undefined, T = unknown>(
    path: string,
    opts: RouteConfig<V, T>,
    handler: RouteHandler<V, T>
  ) {
    await this.addRoute("PUT", path, opts, handler);
  }

  async patch<V extends ValidationSchema | undefined, T = unknown>(
    path: string,
    opts: RouteConfig<V, T>,
    handler: RouteHandler<V, T>
  ) {
    await this.addRoute("PATCH", path, opts, handler);
  }

  async delete<V extends ValidationSchema | undefined, T = unknown>(
    path: string,
    opts: RouteConfig<V, T>,
    handler: RouteHandler<V, T>
  ) {
    await this.addRoute("DELETE", path, opts, handler);
  }

  /**
   * The main `fetch`-like handler. Takes a Request, returns a Response or null if unmatched.
   */
  async handle(req: Request): Promise<Response | null> {
    try {
      // onRequest plugin hook
      const pluginResponse = await this.runPluginHook("onRequest", req);
      if (pluginResponse) return await this.runPluginResponseHook(req, pluginResponse);

      const { pathname } = new URL(req.url);
      const method = req.method as HttpMethod;

      // Global middlewares
      const globalResp = await this.runMiddlewares(req, this.globalMws);
      if (globalResp) return await this.runPluginResponseHook(req, globalResp);

      // Path-based middlewares
      const pathResp = await this.runPathMiddlewares(req, pathname);
      if (pathResp) return await this.runPluginResponseHook(req, pathResp);

      // Find the matching route
      const matched = this.matchRouteHandler(method, pathname);
      if (!matched) {
        const notFound = this.notFoundRes();
        return await this.runPluginResponseHook(req, notFound);
      }

      const { route, params } = matched;
      // Route-level middleware
      const routeMwResp = await this.runMiddlewares(req, route.middleware ?? []);
      if (routeMwResp) return await this.runPluginResponseHook(req, routeMwResp);

      // Finally, call the route's handler
      let res = await route.handler(req, params);
      this.setContentType(res);

      // onResponse plugin hook
      res = await this.runPluginResponseHook(req, res);
      return res;
    } catch (err) {
      // onError plugin hook
      const errorRes = await this.handleError(err, req);
      return await this.runPluginResponseHook(req, errorRes);
    }
  }

  private matchRouteHandler(method: HttpMethod, path: string) {
    for (const r of this.routes) {
      if (r.method !== method) continue;
      const params = matchRoute(path, r.path);
      if (params) return { route: r, params };
    }
    return null;
  }

  /**
   * Runs the validation step, then calls user handler.
   */
  private async runValidationAndHandle<
    V extends ValidationSchema | undefined,
    T
  >(
    req: RequestWithData<T>,
    params: Record<string, string>,
    opts: RouteConfig<V, T>,
    handler: RouteHandler<V, T>
  ): Promise<Response> {
    try {
      const data = await validateRequest(req, params, opts.validation);
      return handler(req, data);
    } catch (e) {
      if (e instanceof ValidationFailedError) {
        return this.buildValidationErrorRes(e);
      }
      throw e;
    }
  }

  private async runMiddlewares(req: Request, mws: Middleware<any>[]): Promise<Response | null> {
    for (const mw of mws) {
      const res = await mw(req as any);
      if (res) return res;
    }
    return null;
  }

  private async runPathMiddlewares(req: Request, path: string): Promise<Response | null> {
    for (const [p, mws] of this.pathMws) {
      if (path.startsWith(p)) {
        const res = await this.runMiddlewares(req, mws);
        if (res) return res;
      }
    }
    return null;
  }

  private buildValidationErrorRes(err: ValidationFailedError): Response {
    const details = err.errors.map(e => ({
      type: e.type,
      messages: e.messages
    }));
    return new Response(
      JSON.stringify({ error: "Validation failed", details }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  private notFoundRes(): Response {
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" }
    });
  }

  private async handleError(error: unknown, req: Request): Promise<Response> {
    const pluginResponse = await this.runPluginHook("onError", error, req);
    if (pluginResponse) return pluginResponse;

    if (this.onError) {
      return this.onError(error, req);
    }

    // Fix #3: Use "An unexpected error occurred." for non-Error throws.
    return new Response(
      JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "An unexpected error occurred."
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  private async runPluginResponseHook(req: Request, res: Response): Promise<Response> {
    for (const plugin of this.plugins) {
      if (plugin.onResponse) {
        const result = await plugin.onResponse(req, res);
        if (result instanceof Response) {
          res = result;
        }
      }
    }
    return res;
  }

  private setContentType(res: Response) {
    if (!res.headers.get("content-type")) {
      res.headers.set("content-type", "application/json");
    }
  }
}