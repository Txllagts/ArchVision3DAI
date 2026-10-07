import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { brand } from "@archvision/config";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge, Panel } from "@/components/ui/surface";
import { PlanCards } from "@/components/billing/plan-cards";
import { BlueprintFloorPlan } from "@/components/landing/blueprint-plan";
import { FaqAccordion } from "@/components/landing/faq-accordion";
import { LandingHeader } from "@/components/landing/landing-header";
import { Reveal } from "@/components/landing/reveal";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Landing comercial.
 *
 * Secciones: hero, como funciona, reconstruccion con IA, editor 3D, planos
 * inteligentes, materiales, casos de uso, comparacion, precios, FAQ, CTA y
 * pie de pagina.
 */

const STEPS = [
  {
    number: "01",
    title: "Sube o dibuja",
    body: "Fotografias de fachada e interiores, un plano en PDF o imagen, o el croquis que dibujes en el editor 2D.",
  },
  {
    number: "02",
    title: "La IA analiza",
    body: "Detecta paredes, puertas, ventanas, niveles y materiales, y estima proporciones con un nivel de confianza por elemento.",
  },
  {
    number: "03",
    title: "Tu corriges",
    body: "Revisas cada deteccion sobre la imagen, calibras con una medida real conocida y ajustas lo que haga falta.",
  },
  {
    number: "04",
    title: "Modelo parametrico",
    body: "Obtienes paredes, vanos y cubiertas editables, no una malla congelada. Cambias un grosor y la geometria se regenera.",
  },
];

const FEATURES = [
  {
    title: "Reconstruccion con IA",
    body: "Deteccion de arquitectura, segmentacion de materiales y estimacion de profundidad. Cada resultado llega con su confianza y siempre es editable.",
    points: ["Deteccion de vanos", "Mapa de profundidad", "Calibracion con medidas reales"],
  },
  {
    title: "Editor 3D en el navegador",
    body: "Viewport WebGL con orbita, gizmos de transformacion, snapping a vertices y ejes, y outliner jerarquico por planta.",
    points: ["Sin instalar nada", "Vistas 2D / 3D / dividida", "Recorrido en primera persona"],
  },
  {
    title: "Planos inteligentes",
    body: "Importa un plano y conviertelo en estructura editable: paredes, habitaciones, cotas y areas calculadas automaticamente.",
    points: ["PDF, JPG, PNG, SVG", "Deteccion de habitaciones", "Areas y perimetros"],
  },
  {
    title: "Materiales y render",
    body: "Biblioteca PBR de ladrillo, concreto, madera, vidrio y ceramica, iluminacion solar por ubicacion y capturas hasta 4K.",
    points: ["Materiales PBR", "Simulacion solar", "Exportacion GLB, OBJ, STL"],
  },
];

const USE_CASES = [
  { title: "Remodelaciones", body: "Levanta el estado actual desde fotos y presenta la propuesta al cliente en la misma sesion." },
  { title: "Bienes raices", body: "Convierte un plano de venta en un recorrido 3D navegable desde el navegador." },
  { title: "Estudios de arquitectura", body: "Anteproyectos rapidos con areas, cantidades aproximadas y renders de presentacion." },
  { title: "Docencia", body: "Enseña composicion espacial sin la curva de aprendizaje de un CAD profesional." },
];

const FAQ = [
  {
    q: "Que tan precisas son las medidas obtenidas de fotografias?",
    a: "Dependen de la calidad y la cantidad de imagenes. Por eso el asistente de calibracion pide al menos una medida real conocida, por ejemplo el ancho de una puerta, y muestra la precision estimada del modelo. Siempre debes verificar las medidas criticas.",
  },
  {
    q: "Puedo editar lo que genera la inteligencia artificial?",
    a: "Si. Ninguna prediccion queda bloqueada: puedes mover, redimensionar, eliminar o crear cualquier elemento. La IA propone, tu decides.",
  },
  {
    q: "En que formatos puedo exportar?",
    a: "GLB, GLTF, OBJ, STL, el formato JSON interno versionado, imagenes PNG o JPG y plano en PDF.",
  },
  {
    q: "Necesito una tarjeta grafica potente?",
    a: "No para proyectos residenciales. El editor aplica instanciado, nivel de detalle y carga progresiva para funcionar en equipos modestos.",
  },
];

const NAV = [
  { href: "#como-funciona", label: "Como funciona" },
  { href: "#capacidades", label: "Capacidades" },
  { href: "#precios", label: "Precios" },
  { href: "#faq", label: "FAQ" },
];

/** Tarjeta de la landing: se eleva y enciende el borde al pasar el cursor. */
const CARD_HOVER =
  "h-full transition-[transform,border-color,background-color,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-1 hover:border-accent/50 hover:bg-surface-2/70 hover:shadow-[0_16px_40px_-20px_rgb(46_167_242/0.35)] motion-reduce:hover:translate-y-0";

export default async function LandingPage() {
  const user = await getSessionUser();
  const primaryHref = user ? "/dashboard" : "/register";
  const primaryLabel = user ? "Ir al dashboard" : "Crear proyecto";

  return (
    <div className="min-h-screen bg-canvas">
      <LandingHeader>
        <div className="mx-auto flex h-20 max-w-6xl items-center justify-between px-4 md:px-8">
          <Logo size="md" />
          <nav className="hidden items-center gap-9 text-[15px] font-medium text-ink-muted md:flex">
            {NAV.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="relative py-1.5 transition-colors duration-200 after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:bg-accent after:transition-transform after:duration-300 after:ease-[cubic-bezier(0.16,1,0.3,1)] hover:text-white hover:after:scale-x-100"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {user ? (
              <Link href="/dashboard">
                <Button size="md" className="font-semibold shadow-sm">Dashboard</Button>
              </Link>
            ) : (
              <>
                <Link href="/login">
                  <Button size="md" variant="ghost">Iniciar sesión</Button>
                </Link>
                <Link href="/register">
                  <Button size="md">Crear cuenta</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </LandingHeader>

      {/* Hero: se traza como un plano (reticula, titular, linea de cota). */}
      <section className="relative -mt-20 overflow-hidden border-b border-line pt-20">
        <div aria-hidden className="hero-grid blueprint-grid-lg absolute inset-0" />
        <div aria-hidden className="absolute inset-0 opacity-30">
          <div className="hero-grid blueprint-grid absolute inset-0" />
        </div>
        
        {/* Plano arquitectónico técnico en el fondo del hero */}
        <div
          aria-hidden
          className="hero-rise pointer-events-none absolute -right-10 top-1/2 w-[48rem] -translate-y-[45%] opacity-35 mix-blend-screen md:right-0 lg:w-[58rem] xl:w-[64rem]"
          style={{
            "--delay": "100ms",
            maskImage: "radial-gradient(ellipse 65% 65% at 70% 50%, #000 30%, transparent 80%)",
            WebkitMaskImage: "radial-gradient(ellipse 65% 65% at 70% 50%, #000 30%, transparent 80%)",
          } as React.CSSProperties}
        >
          <BlueprintFloorPlan />
        </div>

        <div
          aria-hidden
          className="hero-glow pointer-events-none absolute -top-40 right-[-10%] size-[44rem] rounded-full"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
          <div className="hero-rise" style={{ "--delay": "80ms" } as React.CSSProperties}>
            <Badge tone="accent">Reconstruccion asistida por IA</Badge>
          </div>
          <div className="mt-4 inline-block max-w-4xl">
            <h1
              className="hero-rise font-display text-[clamp(2.5rem,5.5vw,4.5rem)] font-bold leading-[1.05] tracking-[-0.01em] text-ink"
              style={{ "--delay": "180ms" } as React.CSSProperties}
            >
              {brand.tagline}
            </h1>
            <div aria-hidden className="cota mt-3">
              <span />
              <span />
            </div>
          </div>
          <p
            className="hero-rise mt-4 max-w-2xl text-base leading-relaxed text-ink-muted md:text-lg"
            style={{ "--delay": "320ms" } as React.CSSProperties}
          >
            {brand.subtitle}
          </p>
          <div
            className="hero-rise mt-6 flex flex-wrap gap-3"
            style={{ "--delay": "440ms" } as React.CSSProperties}
          >
            <Link href={primaryHref}>
              <Button size="lg">
                {primaryLabel}
                <ArrowRight
                  aria-hidden
                  className="size-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/btn:translate-x-1"
                />
              </Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="outline">Ver demostracion</Button>
            </Link>
          </div>
          <p
            className="hero-rise mt-3 text-xs text-ink-subtle"
            style={{ "--delay": "520ms" } as React.CSSProperties}
          >
            Cuenta de demostracion:{" "}
            <span className="font-mono text-ink-muted">demo@archvision.app / arquitectura2026</span>
          </p>

          <dl
            className="hero-rise mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-panel border border-line bg-line md:grid-cols-4"
            style={{ "--delay": "640ms" } as React.CSSProperties}
          >
            {[
              ["4", "metodos de creacion"],
              ["2D / 3D", "editores sincronizados"],
              ["PBR", "materiales y render"],
              ["GLB / OBJ / STL", "exportaciones"],
            ].map(([value, label]) => (
              <div
                key={label}
                className="group bg-surface px-5 py-3.5 transition-colors duration-300 hover:bg-surface-2"
              >
                <dt className="font-mono text-lg text-ink transition-colors duration-300 group-hover:text-accent">
                  {value}
                </dt>
                <dd className="mt-0.5 text-xs text-ink-subtle">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Como funciona */}
      <section id="como-funciona" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 md:px-8 md:py-20">
        <Reveal>
          <h2 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-tight">
            Como funciona
          </h2>
          <p className="mt-3 max-w-2xl text-base text-ink-muted">
            El flujo completo, de la imagen al modelo parametrico, manteniendo el
            control en tus manos en cada paso.
          </p>
        </Reveal>
        <ol className="mt-8 grid gap-4 md:grid-cols-4">
          {STEPS.map((step, index) => (
            <Reveal as="li" key={step.number} delay={index * 90}>
              <Panel className={`group p-5 ${CARD_HOVER}`}>
                <span className="font-mono text-xs text-accent">{step.number}</span>
                <span
                  aria-hidden
                  className="mt-2 block h-px w-8 origin-left bg-accent/60 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-x-[4]"
                />
                <h3 className="mt-3 font-display text-base font-semibold text-ink">{step.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{step.body}</p>
              </Panel>
            </Reveal>
          ))}
        </ol>
      </section>

      {/* Capacidades */}
      <section id="capacidades" className="scroll-mt-20 border-y border-line bg-surface/40">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
          <Reveal>
            <h2 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-tight">
              Capacidades
            </h2>
          </Reveal>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {FEATURES.map((feature, index) => (
              <Reveal key={feature.title} delay={(index % 2) * 100}>
                <Panel className={`p-6 ${CARD_HOVER}`}>
                  <h3 className="font-display text-lg font-semibold text-ink">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{feature.body}</p>
                  <ul className="mt-4 flex flex-wrap gap-2">
                    {feature.points.map((point) => (
                      <li key={point}>
                        <Badge>{point}</Badge>
                      </li>
                    ))}
                  </ul>
                </Panel>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Casos de uso */}
      <section className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
        <Reveal>
          <h2 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-tight">
            Casos de uso
          </h2>
        </Reveal>
        <div className="mt-8 grid gap-4 md:grid-cols-4">
          {USE_CASES.map((item, index) => (
            <Reveal key={item.title} delay={index * 90}>
              <Panel className={`p-5 ${CARD_HOVER}`}>
                <h3 className="font-display text-base font-semibold text-ink">{item.title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">{item.body}</p>
              </Panel>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Precios */}
      <section id="precios" className="scroll-mt-20 border-y border-line bg-surface/40">
        <div className="mx-auto max-w-6xl px-4 py-16 md:px-8 md:py-20">
          <Reveal>
            <h2 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-tight">
              Planes
            </h2>
            <p className="mt-3 max-w-2xl text-base text-ink-muted">
              Precios en pesos colombianos, IVA incluido. Puedes empezar gratis y
              cambiar de plan cuando quieras; al cancelar conservas lo pagado
              hasta el final del periodo.
            </p>
          </Reveal>
          <Reveal className="mt-8" delay={100}>
            <PlanCards />
          </Reveal>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-16 md:px-8 md:py-20">
        <Reveal>
          <h2 className="font-display text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-tight">
            Preguntas frecuentes
          </h2>
        </Reveal>
        <Reveal className="mt-8" delay={80}>
          <FaqAccordion items={FAQ} />
        </Reveal>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden border-t border-line">
        <div aria-hidden className="blueprint-grid absolute inset-0 opacity-30" />
        <Reveal className="relative mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 md:flex-row md:items-center md:justify-between md:px-8">
          <div>
            <h2 className="font-display text-[clamp(1.5rem,2.5vw,2rem)] font-semibold leading-tight">
              Empieza con un proyecto en blanco o con la casa demo
            </h2>
            <p className="mt-2 text-base text-ink-muted">
              Sin instalaciones. Todo ocurre en el navegador.
            </p>
          </div>
          <Link href={primaryHref}>
            <Button size="lg">
              {primaryLabel}
              <ArrowRight
                aria-hidden
                className="size-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/btn:translate-x-1"
              />
            </Button>
          </Link>
        </Reveal>
      </section>

      <footer className="border-t border-line bg-surface/40">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-xs text-ink-subtle md:flex-row md:items-center md:justify-between md:px-8">
          <Logo />
          <p className="max-w-xl">
            {brand.name} · {brand.foundedYear}. Los modelos generados
            automáticamente pueden contener errores dimensionales; verifica las
            medidas importantes.
          </p>
          <Link
            href="/terms"
            className="text-ink-muted hover:text-accent hover:underline transition-colors whitespace-nowrap"
          >
            Términos y Condiciones (SaaS)
          </Link>
        </div>
      </footer>
    </div>
  );
}
