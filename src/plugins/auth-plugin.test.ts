import { describe, test, expect } from "bun:test";
import { Router } from "../router";
import { AuthPlugin } from "./auth-plugin";

describe("Router with Authentication Plugin", () => {
    test("handles successful authentication", async () => {
        // 1. Create a router
        const router = new Router();

        // 2. Create the auth plugin with a mock "verify"
        const mockUser = { userId: "123" };
        const authPlugin = new AuthPlugin({
            verify: async (req) => {
                // In real life, parse token from headers, etc.
                // Here we just return a static user to simulate success
                return mockUser;
            },
            onError: (err) =>
                new Response("Custom error response", {
                    status: 401,
                }),
        });

        // 3. Register the plugin
        await router.registerPlugin(authPlugin);

        // 4. Add a protected route: { auth: true }
        await router.get("/secure", {}, async (req, data) => {
            // If authentication succeeded, req.auth will have our mockUser
            return new Response(JSON.stringify({ success: true }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        });

        // 5. Simulate a request
        const response = await router.handle(
            new Request("https://example.com/secure", {
                method: "GET",
                headers: {
                    // pass "Authorization" or anything your verify logic expects
                    Authorization: "Bearer mockToken",
                },
            })
        );

        // 6. Assert successful auth
        expect(response).not.toBeNull();
        expect(response?.status).toBe(200);

        const body = await response?.json();
        expect(body).toEqual({ success: true, user: mockUser });
    });

    test("handles failed authentication", async () => {
        const router = new Router();

        // Plugin that always throws
        const authPlugin = new AuthPlugin({
            verify: async () => {
                throw new Error("Invalid access token");
            },
            onError: (err) =>
                new Response("Custom error response", {
                    status: 401,
                }),
        });

        await router.registerPlugin(authPlugin);

        await router.get("/secure", {}, async () => {
            return new Response("Should not reach here");
        });

        const response = await router.handle(
            new Request("https://example.com/secure", {
                method: "GET",
                headers: {
                    Authorization: "Bearer badToken",
                },
            })
        );

        // Expect the plugin's onError to have created a 401 response
        expect(response).not.toBeNull();
        expect(response?.status).toBe(401);
        expect(await response?.text()).toBe("Custom error response");
    });

    test("bypasses authentication for routes without auth config", async () => {
        const router = new Router();

        // A plugin that would normally throw an error if route says `auth: true`
        const authPlugin = new AuthPlugin({
            verify: async () => {
                throw new Error("Should not be called");
            },
        });

        await router.registerPlugin(authPlugin);

        // No auth option here
        await router.get("/public-endpoint", {}, async () => {
            return new Response("Public endpoint OK", { status: 200 });
        });

        const response = await router.handle(
            new Request("https://example.com/public-endpoint", { method: "GET" })
        );

        expect(response).not.toBeNull();
        expect(response?.status).toBe(200);
        expect(await response?.text()).toBe("Public endpoint OK");
    });
});