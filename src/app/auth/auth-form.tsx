"use client";

import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

interface AuthFormProps {
  nextPath: string;
}

export function AuthForm({ nextPath }: AuthFormProps): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [sendingLink, setSendingLink] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const getRedirectTarget = (): string => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const next = nextPath.startsWith("/") ? nextPath : "/";
    return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
  };

  const signInEmail = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (sendingLink) return;
    setStatus(null);
    setSendingLink(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: getRedirectTarget(),
        },
      });
      if (error) throw error;
      setStatus("Check your email for the secure sign-in link.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to send email link.";
      setStatus(message);
    } finally {
      setSendingLink(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in to Naming Lab</CardTitle>
          <CardDescription>We will email you a one-time sign-in link. No password required.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={signInEmail} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="friend@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <Button type="submit" variant="default" className="w-full" disabled={sendingLink}>
              {sendingLink ? "Sending link..." : "Send email sign-in link"}
            </Button>
          </form>

          {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
