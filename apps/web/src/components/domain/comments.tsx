"use client";

import type { Comment } from "@resqgrid/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { ago } from "@/lib/format";
import { useT } from "@/lib/i18n";

export function Comments({ parentType, parentId }: { parentType: Comment["parent_type"]; parentId: string }) {
  const tr = useT();
  const qc = useQueryClient();
  const key = ["comments", parentType, parentId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.comments.list(parentType, parentId) });
  const [body, setBody] = useState("");
  const m = useMutation({
    mutationFn: () => api.comments.create(parentType, parentId, body),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: key });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-3">
      {data?.length ? (
        <ul className="flex flex-col gap-2">
          {data.map((c) => (
            <li key={c.id} className="rounded-md bg-muted/60 px-3 py-2 text-sm">
              <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{c.author_name}</span>
                <span>{ago(c.created_at)}</span>
              </div>
              <p className="mt-0.5 whitespace-pre-wrap" dir="auto">{highlightMentions(c.body)}</p>
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
          if (body.trim()) m.mutate();
        }}
      >
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={tr("Add a comment — @name to mention")} className="min-h-10" rows={1} />
        <Button type="submit" size="icon" disabled={!body.trim() || m.isPending} aria-label={tr("Send comment")}>
          <Send />
        </Button>
      </form>
    </div>
  );
}

function highlightMentions(s: string) {
  return s.split(/(@[\p{L}]+)/u).map((part, i) => (part.startsWith("@") ? <strong key={i} className="text-primary">{part}</strong> : part));
}
