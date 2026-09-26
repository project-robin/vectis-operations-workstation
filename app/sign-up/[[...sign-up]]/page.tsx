import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
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
      <SignUp />
    </main>
  );
}
