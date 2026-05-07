import { useEffect, useMemo, useState, type FormEvent } from "react";
import { LockKeyhole, Mail, Sparkles } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

const redirectTarget = () => {
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get("redirect");
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) return "/";
  return redirect;
};

export const Login = () => {
  const { configured, isAuthenticated, isLoading, signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirect = useMemo(redirectTarget, []);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      window.location.replace(redirect);
    }
  }, [isAuthenticated, isLoading, redirect]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await signIn(email.trim(), password);
      window.location.replace(redirect);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "登入失敗，請確認帳號與密碼。");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <span>承氣</span>
          <strong>二十四節氣 AR 設計平台</strong>
        </div>
        <div className="season-orbit" aria-hidden="true">
          <span>春分</span>
          <span>芒種</span>
          <span>白露</span>
          <span>冬至</span>
        </div>
        <form onSubmit={submit}>
          <div className="login-title">
            <Sparkles size={22} />
            <div>
              <h1>後台登入</h1>
              <p>請使用管理員建立的帳號密碼進入作品庫與編輯器。</p>
            </div>
          </div>

          {!configured && <div className="login-warning">目前未設定 Supabase，系統會以本機開發模式略過登入。</div>}

          <label>
            <span>Email</span>
            <div>
              <Mail size={18} />
              <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            </div>
          </label>

          <label>
            <span>Password</span>
            <div>
              <LockKeyhole size={18} />
              <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </div>
          </label>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" disabled={isSubmitting || isLoading}>
            {isSubmitting ? "登入中..." : "登入後台"}
          </button>
        </form>
      </section>
    </main>
  );
};
