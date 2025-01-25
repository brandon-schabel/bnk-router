# **@bnk/router**

A **high-performance**, **type-safe**, and **pluggable** router for **Bun** projects.  
Designed with **minimal dependencies**, clear **TypeScript** definitions, and a flexible **plugin** system.

---

## **Table of Contents**

1. [Introduction](#introduction)  
2. [Installation](#installation)  
3. [Quick Start](#quick-start)  
4. [Usage Examples](#usage-examples)  
   - [Simple Route](#simple-route)  
   - [Route with Validation](#route-with-validation)  
   - [Middleware Example](#middleware-example)  
   - [Plugin Example](#plugin-example)  
5. [API Documentation](#api-documentation)  
   - [Router Class](#router-class)  
   - [json Utility](#json-utility)  
   - [Plugin Interface](#plugin-interface)  
6. [Performance Notes](#performance-notes)  
7. [Configuration & Customization](#configuration--customization)  
8. [Testing](#testing)  
9. [Contributing](#contributing)  
10. [License](#license)

---

## **Introduction**

**@bnk/router** is a **lightweight**, **modular**, and **well-tested** HTTP router built primarily for [Bun](https://bun.sh). It aims to provide:

- **Type safety** with advanced TypeScript features  
- **High performance**, leveraging Bun’s speed  
- **Minimal external dependencies** (relies on `@bnk/cors` and optionally `zod` for validation)  
- **Pluggable architecture**—extend or wrap routes via custom plugins  
- **Straightforward error handling** and built-in JSON response helpers  

---

## **Installation**

Install via **Bun**:

```bash
bun add @bnk/router
```

Optionally, you can use npm or yarn:

```bash
npm install @bnk/router
# or
yarn add @bnk/router
```

---

## **Quick Start**

Below is the fastest way to get a **@bnk/router**-powered server running in Bun.

```ts
import { serve } from 'bun';
import { Router } from '@bnk/router';

const router = new Router();

// Define a simple GET endpoint
router.get('/hello', {}, async () => {
  return new Response('Hello, World!');
});

// Start Bun’s server
serve({
  port: 3000,
  fetch: async (req) => {
    // Pass every request to our router
    const res = await router.handle(req);
    // If router returns null, respond with 404
    return res ?? new Response('Not Found', { status: 404 });
  },
});
```

- Run `bun run index.ts` (or however you start your Bun app).
- Open <http://localhost:3000/hello> to see the response.

---

## **Usage Examples**

### **Simple Route**

```ts
import { Router } from '@bnk/router';

const router = new Router();

// Define routes
router.get('/users', {}, () => {
  return new Response(JSON.stringify({ message: 'GET /users' }), { status: 200 });
});

router.post('/users', {}, async (req) => {
  const user = await req.json();
  return new Response(JSON.stringify({ message: 'User created', user }), { status: 201 });
});
```

### **Route with Validation**

Use [Zod](https://github.com/colinhacks/zod) (or any validator) to validate query, params, headers, or body:

```ts
import { z } from 'zod';
import { Router } from '@bnk/router';

const router = new Router();

// Example schema
const userBodySchema = z.object({
  name: z.string().min(3),
  age: z.number().min(18)
});

router.post(
  '/create-user',
  {
    validation: {
      body: userBodySchema
    }
  },
  async (_, { body }) => {
    // If validation passes, `body` is typed & validated
    return new Response(JSON.stringify({ user: body }), { status: 200 });
  }
);
```

If the request body fails validation, a `400` response with error details is returned automatically.

### **Middleware Example**

You can attach middleware globally or for specific paths/routes. Middleware can either pass the request through (`return null`) or return a `Response` to block/modify behavior:

```ts
const router = new Router();

// Global logging middleware
router.use(async (req) => {
  console.log(`${req.method} ${req.url}`);
  return null; // continue
});

// Path-specific middleware (applies to all routes under "/api")
router.use(async (req) => {
  // e.g., rate limiting check
  return null; // continue
}, '/api');

// Route-specific middleware
router.get(
  '/api/data',
  {
    middleware: [
      async (req) => {
        // Additional checks, etc.
        if (!req.headers.get('Authorization')) {
          return new Response('Unauthorized', { status: 401 });
        }
        return null;
      }
    ]
  },
  () => new Response('Secure data')
);
```

### **Plugin Example**

Plugins can hook into various stages (e.g., `onRequest`, `onError`, `onResponse`). For instance, a simple plugin intercepting every request:

```ts
import { Router, RouterPlugin } from '@bnk/router';

const interceptPlugin: RouterPlugin = {
  name: 'InterceptAll',
  onRequest(req) {
    // If you return a Response here, it short-circuits the router
    if (!req.headers.get('X-Allowed')) {
      return new Response('Blocked by plugin', { status: 403 });
    }
    return null; // continue
  }
};

const router = new Router();
await router.registerPlugin(interceptPlugin);

router.get('/test', {}, () => new Response('Allowed!'));
```

---

## **API Documentation**

### **Router Class**

**Constructor**  
```ts
new Router(options?: RouterOptions)
```
- `options?: RouterOptions`  
  - `onError?: (error: unknown, req: Request) => Response`  
  - `debug?: boolean`  
  - `cors?: CorsOptions` (if you want built-in CORS config via the `CorsPlugin`)

**Key Methods**  
- `router.get(path, opts, handler)`  
- `router.post(path, opts, handler)`  
- `router.put(path, opts, handler)`  
- `router.patch(path, opts, handler)`  
- `router.delete(path, opts, handler)`  
- `router.use(middleware, path?)`  
- `router.registerPlugin(plugin: RouterPlugin)`

**RouteConfig**  
Each route can define:  
```ts
interface RouteConfig<V extends ValidationSchema | undefined, T = unknown> {
  validation?: V;            // e.g. { params: z.object(...), body: z.object(...) }
  middleware?: Middleware<T>[];
}
```

**ValidationSchema**  
```ts
interface ValidationSchema<P, Q, H, B> {
  params?: RouterValidator<P>;
  query?: RouterValidator<Q>;
  headers?: RouterValidator<H>;
  body?: RouterValidator<B>;
}
```
You can use **Zod**, your own validation functions, or any library as long as it matches `RouterValidator<T>`.

### **json Utility**

A convenience helper to create consistent JSON responses:

```ts
import { json } from '@bnk/router';

return json({ success: true }); 
// => Response with status 200, { "success": true }

return json({ error: 'Not found' }, { status: 404 });
// => Response with custom status and JSON body
```

Or send an error with details:

```ts
return json.error('Validation failed', 400, { invalidField: 'email' });
```

### **Plugin Interface**

You can build custom plugins to hook into various stages:

```ts
interface RouterPlugin {
  name: string;
  onInit?(router: Router): void | Promise<void>;
  onBeforeRouteRegister?(...): Promise<{ opts?: RouteConfig; handler?: RouteHandler } | void>;
  onAfterRouteRegister?(...): void | Promise<void>;
  onRequest?(req: Request): Response | null | Promise<Response | null>;
  onError?(error: unknown, req: Request): Response | null | Promise<Response | null>;
  onResponse?(req: Request, res: Response): Response | null | Promise<Response | null>;
}
```

For example, an **auth plugin** can wrap route handlers to ensure users are authenticated before proceeding.

---

## **Performance Notes**

- **Bun**’s HTTP server is extremely fast, and **@bnk/router** directly leverages Bun’s `fetch`-like requests.  
- Minimal overhead: only essential logic is included, with no heavy frameworks.  
- For large-scale apps, consider splitting routes into multiple routers or use **plugin** hooks for shared logic.  

---

## **Configuration & Customization**

1. **Global Options**: Pass a `RouterOptions` object to the constructor for global error handling, debugging, etc.
2. **Middleware**: Insert global, path-based, or route-based middleware for custom logic.
3. **Plugins**: Expand functionality without modifying core router code. For example, add **CORS**, **auth**, or **error** plugins.

---

## **Testing**

All tests are written in **TypeScript** and run via **Bun**’s built-in test runner.  
To run tests locally:

```bash
bun test
```

You can also integrate these tests into your CI/CD pipelines.  
Feel free to add your own `.test.ts` files alongside your code for consistent coverage.

---

## **Contributing**

1. **Fork** the repo and **clone** locally.  
2. Create a new **feature branch** for your changes.  
3. Write or update tests as needed (`bun test`).  
4. Submit a **pull request** describing your changes.  

We welcome issues, PRs, and suggestions!

---

## **License**

This project is open-sourced under the **MIT License**. See the [LICENSE](LICENSE) file for details.