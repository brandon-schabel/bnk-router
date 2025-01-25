import { z } from 'zod';
import { Router } from './router';
import { CorsOptions, HttpMethod } from '@bnk/cors';


// Request Types
export type RequestWithData<T = unknown> = Request & {
  data?: T;
};

// Validation Types
export type RouterValidator<T> =
  | ((input: unknown) => T)
  | {
    parse: (input: unknown) => T;
  };

export interface ValidationSchema<P = any, Q = any, H = any, B = any> {
  params?: RouterValidator<P>;
  query?: RouterValidator<Q>;
  headers?: RouterValidator<H>;
  body?: RouterValidator<B>;
}

export type ValidationErrorItem = {
  type: 'params' | 'query' | 'headers' | 'body';
  messages: string[];
};

export class ValidationFailedError extends Error {
  constructor(public errors: ValidationErrorItem[]) {
    super('Validation failed');
    this.name = 'ValidationFailedError';
  }
}

export interface ValidatedData<V extends ValidationSchema | undefined> {
  params: V extends ValidationSchema<infer P, any, any, any> ? P : any;
  query: V extends ValidationSchema<any, infer Q, any, any> ? Q : any;
  headers: V extends ValidationSchema<any, any, infer H, any> ? H : any;
  body: V extends ValidationSchema<any, any, any, infer B> ? B : any;
}


/**
 * Middleware:
 * - Just receives RequestWithData<T>; returns Response or null if it does nothing.
 */
export type Middleware<T = unknown> = (
  req: RequestWithData<T>
) => Promise<Response | null> | Response | null;

/**
 * RouteHandler:
 * - V: optional ValidationSchema
 * - T: optional extra data on the request
 */
export type RouteHandler<
  V extends ValidationSchema | undefined = undefined,
  T = unknown
> = (
  req: RequestWithData<T>,
  validatedData: ValidatedData<V>
) => Promise<Response> | Response;

export interface RouteConfig<
  V extends ValidationSchema | undefined = undefined,
  T = unknown
> {
  validation?: V;
  middleware?: Middleware<T>[];
}


export interface RouterOptions {
  cors?: CorsOptions;
  debug?: boolean;
  onError?: (error: unknown, req: Request) => Response;
}

export interface Route<T = unknown> {
  path: string;
  method: HttpMethod;
  handler: (req: Request, params: Record<string, string>) => Promise<Response> | Response;
  middleware?: Middleware<T>[];
}



// Type Inference Helpers
export type InferParams<V extends ValidationSchema | undefined> = V extends {
  params: z.ZodTypeAny;
}
  ? z.infer<V['params']>
  : Record<string, string>;

export type InferQuery<V extends ValidationSchema | undefined> = V extends {
  query: z.ZodTypeAny;
}
  ? z.infer<V['query']>
  : Record<string, string>;

export type InferHeaders<V extends ValidationSchema | undefined> = V extends {
  headers: z.ZodTypeAny;
}
  ? z.infer<V['headers']>
  : Record<string, string>;

export type InferBody<V extends ValidationSchema | undefined> = V extends {
  body: z.ZodTypeAny;
}
  ? z.infer<V['body']>
  : unknown;

export type InferValidatedData<V extends ValidationSchema | undefined> = {
  params: InferParams<V>;
  query: InferQuery<V>;
  headers: InferHeaders<V>;
  body: InferBody<V>;
};

// ---------------- PLUGIN INTERFACE MODIFIED BELOW ----------------

/**
 * Extended plugin hook that allows returning updated route config and handler
 * from onBeforeRouteRegister. This way, authentication or other logic can wrap
 * or replace the route handler before the router stores it.
 */
export interface RouterPlugin {
  name: string;

  onInit?(router: Router): Promise<void> | void;

  /**
   * Called just before the router permanently stores the route’s config and handler.
   * You can mutate/wrap the handler or config here if needed. Return an object with
   * updated `opts` and/or `handler`. If you return nothing, the router uses the original.
   */
  onBeforeRouteRegister?(
    router: Router,
    method: HttpMethod,
    path: string,
    opts: RouteConfig<any, any>,
    handler: RouteHandler<any, any>
  ): Promise<{
    opts?: RouteConfig<any, any>;
    handler?: RouteHandler<any, any>;
  } | void>;

  onAfterRouteRegister?(
    router: Router,
    method: HttpMethod,
    path: string,
    opts: RouteConfig<any, any>
  ): Promise<void> | void;

  /**
   * Called at the beginning of router.handle(req). If you return a Response, it short-circuits.
   */
  onRequest?(req: Request): Promise<Response | null> | Response | null;

  /**
   * Called if an error is thrown while processing the request, before the router calls its
   * global onError. If you return a Response, it short-circuits.
   */
  onError?(error: unknown, req: Request): Promise<Response | null> | Response | null;

  /**
   * Called just before returning the final response. You can modify or replace the Response here.
   */
  onResponse?(req: Request, res: Response): Promise<Response | null> | Response | null;
}

// Keep this for hooking logic
export type PluginHookFunction = (...args: any[]) => Promise<any> | any;