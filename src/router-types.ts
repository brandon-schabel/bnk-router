import { Router } from './router';
import { CorsOptions, HttpMethod } from '@bnk/cors';


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

// Request Types
export type RequestWithData<T = unknown> = Request & {
  data?: T;
  auth?: AuthData;
};

// Validation Types
export interface AnySchema<T> {
  parse: (input: unknown) => T;
}

export type RouterValidator<T> =
  | ((input: unknown) => T)
  | AnySchema<T>;

export interface ValidationSchema<
  P = any,
  Q = any,
  H = any,
  B = any
> {
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
    super("Validation failed");
    this.name = "ValidationFailedError";
  }
}

export interface ValidatedData<
  V extends ValidationSchema | undefined
> {
  params: V extends ValidationSchema<infer P, any, any, any> ? P : any;
  query: V extends ValidationSchema<any, infer Q, any, any> ? Q : any;
  headers: V extends ValidationSchema<any, any, infer H, any> ? H : any;
  body: V extends ValidationSchema<any, any, any, infer B> ? B : any;
}

// Router Types
export type Middleware<T = unknown> = (
  req: RequestWithData<T>
) => Promise<Response | null> | Response | null;

export type RouteHandler<
  V extends ValidationSchema | undefined = undefined,
  A = AuthData,
  T = unknown
> = (
  req: RequestWithData<T>,
  validatedData: ValidatedData<V> & { auth?: A }
) => Promise<Response> | Response;

export interface RouteConfig<V extends ValidationSchema | undefined = undefined, A = AuthData, T = unknown> {
  auth?: boolean | AuthMiddlewareConfig<A> | AuthHandlerRef;
  validation?: V;
  middleware?: Middleware<T>[];
}

export interface RouterOptions {
  cors?: CorsOptions;
  debug?: boolean;
  onError?: (error: unknown, req: Request) => Response;
  auth?: AuthConfig;
}

export interface Route<T = unknown> {
  path: string;
  method: HttpMethod;
  handler: (req: Request, params: Record<string, string>) => Promise<Response> | Response;
  middleware?: Middleware<T>[];
}

// Auth Middleware Types
export interface AuthMiddlewareConfig<A = AuthData> {
  verify: (req: Request) => Promise<A>;
  onError?: (error: Error) => Response;
}

export interface AuthHandlerRef {
  verify: (req: Request) => Promise<AuthData>;
  onError?: (error: Error) => Response;
}

// Type Inference Helpers
type InferSchema<T> =
  T extends AnySchema<infer Parsed>
    ? Parsed
    : T extends (input: unknown) => infer FnReturn
    ? FnReturn
    : unknown;

export type InferParams<V extends ValidationSchema | undefined> =
  V extends { params: infer P } ? InferSchema<P> : Record<string, string>;

export type InferQuery<V extends ValidationSchema | undefined> =
  V extends { query: infer Q } ? InferSchema<Q> : Record<string, string>;

export type InferHeaders<V extends ValidationSchema | undefined> =
  V extends { headers: infer H } ? InferSchema<H> : Record<string, string>;

export type InferBody<V extends ValidationSchema | undefined> =
  V extends { body: infer B } ? InferSchema<B> : unknown;

export type InferValidatedData<V extends ValidationSchema | undefined> = {
  params: InferParams<V>;
  query: InferQuery<V>;
  headers: InferHeaders<V>;
  body: InferBody<V>;
};

export interface RouterPlugin {
  name: string;
  onInit?(router: Router): Promise<void> | void;
  onBeforeRouteRegister?(router: Router, method: HttpMethod, path: string, opts: RouteConfig<any, any, any>): Promise<void> | void;
  onAfterRouteRegister?(router: Router, method: HttpMethod, path: string, opts: RouteConfig<any, any, any>): Promise<void> | void;
  onRequest?(req: Request): Promise<Response | null> | Response | null;
  onError?(error: unknown, req: Request): Promise<Response | null> | Response | null;
  onResponse?(req: Request, res: Response): Promise<Response | null> | Response | null;
}

export type PluginHookFunction = (...args: any[]) => Promise<any> | any;