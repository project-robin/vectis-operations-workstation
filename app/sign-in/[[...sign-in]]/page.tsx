import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <main className="auth-page">
      <div className="auth-brand">
        <span className="brand-mark" aria-hidden="true">
          V
        </span>
        <div>
          <strong className="brand-title">Vectis</strong>
          <span className="brand-subtitle">AI Receptionist</span>
        </div>
      </div>
      <SignIn />
    </main>
  );
}
