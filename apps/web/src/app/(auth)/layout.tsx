import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LegalNotice } from "@/components/legal/terms-modal";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative grid min-h-screen place-items-center px-4 py-12">
      <div aria-hidden className="blueprint-grid absolute inset-0 opacity-40" />
      <div className="relative w-full max-w-sm">
        <Link href="/" className="mb-6 inline-flex">
          <Logo />
        </Link>
        {children}
        <div className="mt-6 text-center">
          <LegalNotice />
        </div>
      </div>
    </div>
  );
}
