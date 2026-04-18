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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const getRedirectTarget = (): string => {
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const next = nextPath.startsWith("/") ? nextPath : "/";
    return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
  };

  const signInEmail = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (sendingLink) return;
    setErrorMessage(null);
    setLinkSentTo(null);
    setSendingLink(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const trimmed = email.trim();
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: {
          emailRedirectTo: getRedirectTarget(),
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
      setLinkSentTo(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to send email link.";
      setErrorMessage(message);
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
                onChange={(event) => {
                  setEmail(event.target.value);
                  setLinkSentTo(null);
                  setErrorMessage(null);
                }}
                required
              />
            </div>
            <Button type="submit" variant="default" className="w-full" disabled={sendingLink}>
              {sendingLink ? "Sending link..." : "Send email sign-in link"}
            </Button>
          </form>

          {linkSentTo ? (
            <div className="space-y-3 rounded-md border border-border bg-muted/40 p-4 text-sm text-foreground">
              <p className="font-medium">We sent a sign-in link</p>
              <p className="text-muted-foreground">
                Open the message sent to <span className="font-medium text-foreground">{linkSentTo}</span>{" "}
                and tap <strong className="text-foreground">Log in</strong> (or the button in that email).
                You will land back in Naming Lab signed in.
              </p>
              <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
                <li>Check spam or promotions if nothing arrives within a minute or two.</li>
                <li>Magic links expire; request a new one from this page if the link is old.</li>
                <li>
                  To change the sender name, subject, or wording of that email, use Supabase → Authentication
                  → Email templates (and optional custom SMTP).
                </li>
              </ul>
            </div>
          ) : null}
          {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}
        </CardContent>
      </Card>
    </main>
  );
}
