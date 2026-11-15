"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CATEGORIES, PRIORITIES, type LatLng } from "@resqgrid/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { LiveMap } from "@/components/map/live-map";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { CATEGORY_LABEL, PRIORITY_LABEL } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useT } from "@/lib/i18n";

const schema = z.object({
  category: z.enum(CATEGORIES),
  priority: z.enum(PRIORITIES).optional().or(z.literal("")),
  description: z.string().min(5, "Describe what happened"),
  address_text: z.string().optional(),
  people_affected: z.coerce.number().int().min(0).optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
});
type Form = z.input<typeof schema>;

/** Internal report entry for dispatchers taking calls, walk-ins, or field reports (REP-1, staff side). */
export function NewReportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const tr = useT();
  const { org } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const [loc, setLoc] = useState<LatLng>();
  const { register, handleSubmit, formState, reset } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { category: "medical", priority: "" } });
  const create = useMutation({
    mutationFn: (f: z.output<typeof schema>) => api.reports.create({ ...f, priority: f.priority || undefined, location: loc! }),
    onSuccess: (r) => {
      toast.success(`${tr("Created")} ${r.reference_code}`);
      qc.invalidateQueries({ queryKey: ["reports"] });
      reset();
      setLoc(undefined);
      onOpenChange(false);
      router.push(`/dispatch?report=${r.id}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={tr("New report")} description={tr("For calls, walk-ins and field reports. Click the map to set the location.")} className="max-w-2xl">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((f) => (loc ? create.mutate(f as z.output<typeof schema>) : toast.error(tr("Set the location on the map"))))}>
          <Field label={tr("Category")}>
            <Select {...register("category")}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {tr(CATEGORY_LABEL[c])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Priority")} hint={tr("Leave on default to apply the category rule")}>
            <Select {...register("priority")}>
              <option value="">{tr("Category default")}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {tr(PRIORITY_LABEL[p])}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={tr("Description")} className="sm:col-span-2" error={formState.errors.description?.message ? tr(formState.errors.description.message) : undefined}>
            <Textarea {...register("description")} />
          </Field>
          <div className="h-56 overflow-hidden rounded-md border sm:col-span-2">
            <LiveMap center={org?.operating_area.center} zoom={13} pick={{ value: loc, onChange: setLoc }} />
          </div>
          <Field label={tr("Address / landmark")}>
            <Input {...register("address_text")} />
          </Field>
          <Field label={tr("People affected")}>
            <Input type="number" min={0} {...register("people_affected")} />
          </Field>
          <Field label={tr("Reporter name")}>
            <Input {...register("name")} />
          </Field>
          <Field label={tr("Reporter phone")}>
            <Input type="tel" {...register("phone")} />
          </Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {tr("Cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {tr("Create report")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
