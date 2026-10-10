import React from "react";
import { Shield, FileText, Scale, Database, Cpu, CreditCard, Lock, HelpCircle } from "lucide-react";

export function TermsContent() {
  return (
    <div className="space-y-8 text-left text-sm text-ink-muted leading-relaxed">
      {/* Encabezado */}
      <div className="rounded-lg border border-line bg-surface-2/60 p-4 text-left">
        <div className="flex items-center gap-2 text-ink font-semibold">
          <Scale className="size-4 text-accent shrink-0" />
          <span>Marco Legal SaaS · República de Colombia</span>
        </div>
        <p className="mt-2 text-xs text-ink-subtle">
          Este documento regula el acceso, suscripción y uso de la plataforma de software como servicio (SaaS),
          conforme a la legislación de comercio electrónico, protección al consumidor y datos personales de Colombia.
        </p>
      </div>

      {/* Sección 1 */}
      <section id="terminos-1" className="space-y-2">
        <div className="flex items-center gap-2 text-ink font-medium">
          <FileText className="size-4 text-accent shrink-0" />
          <h3 className="text-base font-semibold">1. Aceptación y Marco Legal Aplicable</h3>
        </div>
        <p>
          Al registrarse, iniciar sesión o utilizar los servicios de <strong className="text-ink">ArchVision 3D AI</strong>,
          el usuario celebra un contrato vinculante de prestación de servicios bajo la modalidad de Software as a Service (SaaS).
          El presente acuerdo se rige íntegramente por las leyes de la República de Colombia, en especial:
        </p>
        <ul className="list-disc pl-5 space-y-1 text-xs text-ink-muted">
          <li>
            <strong className="text-ink">Ley 527 de 1999:</strong> Validez jurídica de los mensajes de datos y comercio electrónico.
          </li>
          <li>
            <strong className="text-ink">Ley 1480 de 2011 (Estatuto del Consumidor):</strong> Derechos del consumidor en compras digitales y servicios en línea.
          </li>
          <li>
            <strong className="text-ink">Ley 1581 de 2012 y Decreto 1377 de 2013:</strong> Régimen general de protección de datos personales (Habeas Data).
          </li>
          <li>
            <strong className="text-ink">Ley 23 de 1982 y Decisión Andina 351 de 1993:</strong> Régimen de propiedad intelectual y derechos de autor.
          </li>
        </ul>
      </section>

      {/* Sección 2 */}
      <section id="terminos-2" className="space-y-2">
        <div className="flex items-center gap-2 text-ink font-medium">
          <Database className="size-4 text-accent shrink-0" />
          <h3 className="text-base font-semibold">2. Naturaleza del Servicio SaaS y Licencia de Uso</h3>
        </div>
        <p>
          ArchVision 3D AI concede al usuario una licencia de uso limitada, no exclusiva, revocable, intransferible y en la nube
          para acceder a las herramientas de diseño arquitectónico 2D/3D, conversión de imágenes y planos a modelos tridimensionales,
          cálculo volumétrico y renderizado en tiempo real según el plan de suscripción contratado.
        </p>
        <p>
          El servicio se presta a través del navegador web sin requerir instalación de servidores locales propios.
        </p>
      </section>

      {/* Sección 3 */}
      <section id="terminos-3" className="space-y-2">
        <div className="flex items-center gap-2 text-ink font-medium">
          <Shield className="size-4 text-accent shrink-0" />
          <h3 className="text-base font-semibold">3. Propiedad Intelectual del Usuario sobre sus Proyectos</h3>
        </div>
        <div className="rounded-md border border-ok/30 bg-ok/5 p-3.5 text-xs text-ink">
          <strong className="block text-ok font-semibold mb-1">
            Garantía de titularidad de tus diseños arquitectónicos:
          </strong>
          El usuario conserva el 100% de la propiedad intelectual, derechos patrimoniales y derechos morales sobre todos los
          planos, esquemas, croquis, imágenes, modelos 3D y especificaciones que cargue, cree o exporte en la plataforma.
          ArchVision 3D AI no reclama ningún derecho de propiedad sobre los proyectos del usuario.
        </div>
      </section>

      {/* Sección 4 */}
      <section id="terminos-4" className="space-y-2">
        <div className="flex items-center gap-2 text-ink font-medium">
          <Cpu className="size-4 text-accent shrink-0" />
          <h3 className="text-base font-semibold">4. Reconstrucción con Inteligencia Artificial y Responsabilidad Profesional</h3>
        </div>
        <p>
          Los algoritmos de inteligencia artificial, análisis de imágenes, segmentación de muros y extrusión paramétrica
          provistos por la plataforma son <strong className="text-ink">herramientas de asistencia al prediseño y visualización</strong>.
        </p>
        <div className="rounded-md border border-warn/30 bg-warn/5 p-3.5 text-xs text-ink-muted">
          <p>
            <strong className="text-warn font-semibold">Aviso Técnico de Ingeniería y Arquitectura:</strong> Las medidas,
            alturas y áreas generadas automáticamente deben ser revisadas y calibradas por el usuario. El cumplimiento de las
            normas técnicas colombianas (incluyendo el Reglamento Colombiano de Construcción Sismo Resistente{" "}
            <strong className="text-ink">NSR-10</strong> y las licencias urbanísticas ante Curaduría Urbana) es responsabilidad
            exclusiva del arquitecto, ingeniero o profesional a cargo del proyecto.
          </p>
        </div>
      </section>

      {/* Sección 5 */}
      <section id="terminos-5" className="space-y-2">
        <div className="flex items-center gap-2 text-ink font-medium">
          <CreditCard className="size-4 text-accent shrink-0" />
          <h3 className="text-base font-semibold">5. Planes, Facturación y Cancelaciones</h3>
        </div>
        <p>
          Las suscripciones se cobran en <strong className="text-ink">pesos colombianos (COP)</strong> con el Impuesto al Valor
          Agregado (<strong className="text-ink">IVA</strong>) incluido según la tarifa vigente en Colombia.
        </p>
        <ul className="list-disc pl-5 space-y-1 text-xs text-ink-muted">
          <li>
            <strong className="text-ink">Renovación Periódica:</strong> Los planes mensuales o anuales se renuevan al vencimiento del ciclo salvo cancelación previa.
          </li>
          <li>
            <strong className="text-ink">Cancelación sin Penalidad:</strong> El usuario puede cancelar su suscripción en cualquier momento desde su panel de facturación. Mantendrá acceso a las funcionalidades del plan hasta la finalización del periodo pagado.
          </li>
          <li>
            <strong className="text-ink">Reversión del Pago:</strong> Aplica el derecho de reversión conforme al artículo 51 de la Ley 1480 de 2011 ante eventos de fraude, operaciones no solicitadas o fallas técnicas imputables a la plataforma.
          </li>
        </ul>
      </section>

      {/* Sección 6 */}
      <section id="terminos-6" className="space-y-2">
        <div className="flex items-center gap-2 text-ink font-medium">
          <Lock className="size-4 text-accent shrink-0" />
          <h3 className="text-base font-semibold">6. Protección de Datos Personales (Ley 1581 de 2012)</h3>
        </div>
        <p>
          ArchVision 3D AI actúa como responsable del tratamiento de los datos personales suministrados (nombre, correo electrónico
          y registros de acceso). La recolección de estos datos tiene como finalidad exclusiva la autenticación, prestación
          del servicio SaaS, facturación y soporte técnico.
        </p>
        <p className="text-xs">
          El titular tiene derecho a conocer, actualizar, rectificar y suprimir sus datos en cualquier momento mediante solicitud
          a <a href="mailto:soporte@archvision.app" className="text-accent underline">soportearchvision3dai@gmail.com</a>.
        </p>
      </section>

      {/* Sección 7 */}
      <section id="terminos-7" className="space-y-2">
        <div className="flex items-center gap-2 text-ink font-medium">
          <HelpCircle className="size-4 text-accent shrink-0" />
          <h3 className="text-base font-semibold">7. Disponibilidad del Servicio y Soporte</h3>
        </div>
        <p>
          ArchVision 3D AI implementa medidas de alta disponibilidad, copias de seguridad continuas y cifrado TLS para proteger
          la información. La plataforma programa mantenimientos técnicos procurando el menor impacto y notificando oportunamente
          a los usuarios activos.
        </p>
      </section>

      {/* Sección 8 */}
      <section id="terminos-8" className="space-y-2 border-t border-line pt-4">
        <h3 className="text-sm font-semibold text-ink">8. Ley Aplicable y Jurisdicción</h3>
        <p className="text-xs">
          Cualquier controversia derivada de la interpretación o ejecución de estos términos será resuelta bajo las leyes
          de la República de Colombia, sometiéndose las partes a la jurisdicción de los jueces y tribunales colombianos.
        </p>
      </section>
    </div>
  );
}
