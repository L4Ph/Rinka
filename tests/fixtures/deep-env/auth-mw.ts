// A middleware that reads a host binding — imported and applied by a route.
export const auth = async (c: any, next: () => Promise<void>) => {
  const secret = c.env.SECRET;
  if (!secret) throw new Error("no secret");
  await next();
};
