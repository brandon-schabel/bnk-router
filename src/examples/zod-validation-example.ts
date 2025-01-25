import { z } from 'zod';
import { Router } from '../router';
import type { RouterValidator, ValidationSchema } from '../router-types';

// Example of converting a Zod schema to our RouterValidator type
function zodValidator<T>(schema: z.ZodType<T>): RouterValidator<T> {
  return (input: unknown) => {
    const result = schema.safeParse(input);
    if (!result.success) {
      const messages = result.error.errors.map(e => e.message);
      throw new Error(messages.join('; '));
    }
    return result.data;
  };
}

// Example schemas
const userParamsSchema = z.object({
  userId: z.string().uuid()
});

const userBodySchema = z.object({
  name: z.string().min(1),
  age: z.number().min(18)
});

// Create validation schema using our validators
const validation: ValidationSchema<
  z.infer<typeof userParamsSchema>,
  any,
  any,
  z.infer<typeof userBodySchema>
> = {
  params: zodValidator(userParamsSchema),
  body: zodValidator(userBodySchema)
};

// Example usage
async function main() {
  const router = new Router();

  // Register a route with Zod validation
  router.put(
    '/users/:userId',
    { validation },
    async (req, { params, body }) => {
      // params and body are fully typed based on the Zod schemas
      return new Response(
        JSON.stringify({
          updatedUserId: params.userId, // typed as string (uuid)
          newName: body.name,           // typed as string
          newAge: body.age             // typed as number
        }),
        { status: 200 }
      );
    }
  );

  // Example request
  const req = new Request('http://localhost/users/550e8400-e29b-41d4-a716-446655440000', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Alice', age: 30 })
  });

  const res = await router.handle(req);
  console.log(await res?.text());
}

// Run the example
main().catch(console.error); 