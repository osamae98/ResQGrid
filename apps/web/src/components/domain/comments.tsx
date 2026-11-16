"use client";

import { MENTION_RE, type Comment, type DirectoryUser } from "@resqgrid/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { ago, initials, ROLE_LABEL } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useDirectory } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

/** "@sa" right before the caret opens the picker; letters, digits and dots only, so a space closes it. */
const ACTIVE_QUERY = /(?:^|\s)@([\p{L}\p{N}._-]{0,30})$/u;

export function Comments({ parentType, parentId }: { parentType: Comment["parent_type"]; parentId: string }) {
  const tr = useT();
  const qc = useQueryClient();
  const key = ["comments", parentType, parentId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.comments.list(parentType, parentId) });
  const [body, setBody] = useState("");
  // Display name → user id for people picked from the list; turned into @[Name](id) tokens on send.
  const [picked, setPicked] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: () => api.comments.create(parentType, parentId, encodeMentions(body, picked)),
    onSuccess: () => {
      setBody("");
      setPicked({});
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const send = () => body.trim() && !m.isPending && m.mutate();

  return (
    <div className="flex flex-col gap-3">
      {data?.length ? (
        <ul className="flex flex-col gap-2">
          {data.map((c) => (
            <li key={c.id} className="rounded-md bg-muted/60 px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground" dir="auto">
                  {c.author_name}
                </span>
                <span>{ago(c.created_at)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap leading-relaxed" dir="auto">
                <CommentBody comment={c} />
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{tr("No comments yet.")}</p>
      )}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <MentionInput value={body} onChange={setBody} onPick={(u) => setPicked((p) => ({ ...p, [u.name]: u.id }))} onSubmit={send} />
        <Button type="submit" size="icon" disabled={!body.trim() || m.isPending} aria-label={tr("Send comment")}>
          <Send className="rtl:-scale-x-100" />
        </Button>
      </form>
    </div>
  );
}

/** Replace "@Sara Nabil" for people chosen from the picker with "@[Sara Nabil](usr_…)" (longest names first). */
function encodeMentions(text: string, picked: Record<string, string>) {
  let out = text;
  for (const [name, id] of Object.entries(picked).sort((a, b) => b[0].length - a[0].length)) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`@${esc}(?![\\p{L}\\p{N}\\]])`, "gu"), `@[${name}](${id})`);
  }
  return out;
}

function MentionInput({
  value,
  onChange,
  onPick,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (u: DirectoryUser) => void;
  onSubmit: () => void;
}) {
  const tr = useT();
  const listId = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const directory = useDirectory();
  const { user: me } = useSession();
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string>();

  const query = ACTIVE_QUERY.exec(value.slice(0, caret))?.[1];
  const matches = useMemo(() => {
    if (query === undefined) return [];
    const q = query.toLowerCase();
    // Best match first: first name starts with it, then any name part does, then it appears anywhere.
    const score = (name: string) => {
      const n = name.toLowerCase();
      const words = n.split(/\s+/);
      return !q || words[0].startsWith(q) ? 0 : words.some((w) => w.startsWith(q)) ? 1 : n.includes(q) ? 2 : -1;
    };
    return (directory.data ?? [])
      .filter((u) => u.id !== me?.id)
      .map((u) => ({ u, s: score(u.name) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => a.s - b.s || a.u.name.localeCompare(b.u.name))
      .slice(0, 6)
      .map((x) => x.u);
  }, [query, directory.data, me?.id]);
  const open = query !== undefined && dismissed !== `${caret}:${query}`;

  const pick = (u: DirectoryUser) => {
    const start = caret - (query?.length ?? 0) - 1; // position of "@"
    const next = `${value.slice(0, start)}@${u.name} ${value.slice(caret)}`;
    const pos = start + u.name.length + 2;
    onChange(next);
    onPick(u);
    setActive(0);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  return (
    <div className="relative flex-1">
      <Textarea
        ref={ref}
        value={value}
        rows={1}
        dir="auto"
        className="min-h-10"
        placeholder={tr("Add a comment. Type @ to mention someone.")}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setActive(0);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onKeyDown={(e) => {
          if (open && matches.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(matches[active]);
              return;
            }
          }
          if (open && e.key === "Escape") {
            e.preventDefault();
            setDismissed(`${caret}:${query}`);
            return;
          }
          // Enter sends, Shift+Enter adds a line (chat convention).
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {open ? (
        <div className="absolute inset-x-0 bottom-full z-20 mb-1 overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-lg">
          <div className="border-b px-3 py-1.5 text-[11px] font-medium text-muted-foreground">{tr("Mention someone")}</div>
          {matches.length ? (
            <ul id={listId} role="listbox" aria-label={tr("Mention someone")} className="p-1">
              {matches.map((u, i) => (
                <li
                  key={u.id}
                  id={`${listId}-${u.id}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(u)}
                  className={cn("flex cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm", i === active && "bg-accent")}
                >
                  <Avatar name={u.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      <bdi>{u.name}</bdi>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {tr(ROLE_LABEL[u.role])}
                      {u.team_name ? ` · ${u.team_name}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p id={listId} className="px-3 py-2 text-sm text-muted-foreground">
              {directory.isLoading ? tr("Loading") : tr("No one matches")}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-7 shrink-0 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary", className)}>
      {initials(name).slice(0, 2)}
    </span>
  );
}

/** Mentions become user chips; anything else stays plain text (an @word that isn't a person isn't highlighted). */
function CommentBody({ comment }: { comment: Comment }) {
  const tr = useT();
  const { user: me } = useSession();
  const directory = useDirectory();
  const byId = useMemo(() => new Map((directory.data ?? []).map((u) => [u.id, u])), [directory.data]);
  // Older comments used @firstname; they're a person only if the server resolved them into `mentions`.
  const legacy = useMemo(() => new Map(comment.mentions.map((n) => [n.split(" ")[0].toLowerCase(), n])), [comment.mentions]);

  const parts: React.ReactNode[] = [];
  let last = 0;
  const text = comment.body;
  for (const m of text.matchAll(MENTION_RE)) {
    parts.push(...plainWithLegacy(text.slice(last, m.index), legacy, me?.name, parts.length));
    const u = byId.get(m[2]);
    parts.push(<MentionChip key={`m${m.index}`} name={u?.name ?? m[1]} sub={u ? tr(ROLE_LABEL[u.role]) : undefined} isMe={m[2] === me?.id} />);
    last = (m.index ?? 0) + m[0].length;
  }
  parts.push(...plainWithLegacy(text.slice(last), legacy, me?.name, parts.length));
  return <>{parts}</>;
}

function plainWithLegacy(s: string, legacy: Map<string, string>, myName: string | undefined, keyBase: number): React.ReactNode[] {
  if (!legacy.size) return [s];
  return s.split(/(@[\p{L}]+)/u).map((part, i) => {
    const name = part.startsWith("@") ? legacy.get(part.slice(1).toLowerCase()) : undefined;
    return name ? <MentionChip key={`l${keyBase}-${i}`} name={name} isMe={name === myName} /> : part;
  });
}

function MentionChip({ name, sub, isMe }: { name: string; sub?: string; isMe?: boolean }) {
  const tr = useT();
  return (
    <span
      title={sub ? `${name} · ${sub}` : name}
      className={cn(
        "mx-0.5 inline-flex translate-y-px items-center gap-1 rounded-full py-px pe-2 ps-0.5 align-baseline text-[0.9em] font-medium",
        isMe ? "bg-high/15 text-high" : "bg-primary/10 text-primary",
      )}
    >
      <span aria-hidden className={cn("grid size-4 place-items-center rounded-full text-[9px] font-bold", isMe ? "bg-high text-white" : "bg-primary text-primary-foreground")}>
        {initials(name).slice(0, 2)}
      </span>
      <span dir="auto">
        @{name}
        {isMe ? <span className="sr-only"> ({tr("you")})</span> : null}
      </span>
    </span>
  );
}
