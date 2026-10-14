import { prisma } from "@archvision/database";
import { loginSchema } from "@archvision/validation";
import { apiError, apiSuccess, apiValidationError, readJsonBody, withErrorHandling } from "@/lib/api/response";
import { clientIp, clientKey, consume } from "@/lib/api/rate-limit";
import { fakeVerify, verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

/** POST /api/auth/login */
export async function POST(request: Request) {
  return withErrorHandling("auth.login", async () => {
    const limit = consume(clientKey(request, "login"), 10, 10 * 60 * 1000);
    if (!limit.allowed) {
      return apiError(
        "RATE_LIMITED",
        `Demasiados intentos. Reintenta en ${limit.retryAfterSeconds} segundos.`,
      );
    }

    const body = await readJsonBody(request, 8 * 1024);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return apiValidationError(parsed.error);

    const { email, password } = parsed.data;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      // Coste de verificacion equivalente: no se revela si el correo existe.
      await fakeVerify();
      return apiError("UNAUTHORIZED", "Correo o contraseña incorrectos");
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return apiError("UNAUTHORIZED", "Correo o contraseña incorrectos");
    }

    await createSession(user.id, {
      userAgent: request.headers.get("user-agent"),
      ipAddress: clientIp(request),
    });

    await prisma.auditEvent.create({
      data: {
        userId: user.id,
        action: "auth.login",
        targetType: "user",
        targetId: user.id,
        ipAddress: clientIp(request),
      },
    });

    return apiSuccess({ id: user.id, email: user.email, name: user.name });
  });
}
