import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
SafeAreaTopScrim,
bytesToBase64,
fileToBase64,
setFailureNoticeText,
} from "@hatch/space-sdk/client";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { api, type ApiResponse } from "./api";

setFailureNoticeText((_error, message) => `No se pudo guardar. ${message}`);

const FIELDS = actionFields<typeof Actions>();

type Ticket = ApiResponse<typeof api, "listTickets">["tickets"][number];
type Portal = ApiResponse<typeof api, "listPortals">["portals"][number];
type Profile = NonNullable<ApiResponse<typeof api, "getFiscalProfile">["profile"]>;

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function money(n: number): string {
  return n.toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  });
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function monthLabel(key: string): string {
  const [y = 1970, m = 1] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1] ?? ""} ${y}`;
}

function todayISO(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function usoCfdi(t: { isGasoline: boolean }): string {
  return t.isGasoline
    ? "G03 · Gastos en general (gasolina)"
    : "G01 · Adquisición de mercancías";
}

/** Convierte HEIC/HEIF de iPhone a JPEG antes de subir; otros formatos pasan igual. */
async function preparePhoto(
  file: File,
): Promise<{ dataBase64: string; mimeType: string } | null> {
  const name = file.name.toLowerCase();
  const isHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    name.endsWith(".heic") ||
    name.endsWith(".heif");
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    if (isHeic) return null;
    const { dataBase64, mimeType } = await fileToBase64(file);
    return { dataBase64, mimeType: mimeType || "image/jpeg" };
  }
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx2d = canvas.getContext("2d");
  if (!ctx2d) return null;
  ctx2d.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85),
  );
  if (!blob) return null;
  const buf = await blob.arrayBuffer();
  return {
    dataBase64: bytesToBase64(new Uint8Array(buf)),
    mimeType: "image/jpeg",
  };
}

type Section = "tickets" | "fiscales" | "portales";

export function App() {
  const [section, setSection] = useState<Section>("tickets");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);

  const ticketsQ = useQuery({
    queryKey: ["tickets"],
    queryFn: () => api.listTickets({}),
  });
  const tickets = ticketsQ.data?.tickets ?? [];
  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <main className="mx-auto w-full max-w-2xl px-4 pb-28">
        {section === "tickets" && (
          <TicketsSection
            tickets={tickets}
            loading={ticketsQ.isPending}
            error={ticketsQ.error ? String(ticketsQ.error) : null}
            onSelect={(t) => setSelectedId(t.id)}
            onAdd={() => setShowForm(true)}
          />
        )}
        {section === "fiscales" && <FiscalSection />}
        {section === "portales" && <PortalsSection />}
      </main>

      <nav
        aria-label="Secciones"
        className="fixed inset-x-0 bottom-0 border-t border-[var(--border)] bg-[var(--surface)] pb-safe"
      >
        <div className="mx-auto flex max-w-2xl">
          {(
            [
              ["tickets", "Tickets"],
              ["fiscales", "Datos fiscales"],
              ["portales", "Portales"],
            ] as Array<[Section, string]>
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              aria-current={section === key ? "page" : undefined}
              className={`flex-1 px-2 py-3 text-sm font-medium ${
                section === key
                  ? "text-[var(--accent)]"
                  : "text-[var(--dim)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>

      {selected && (
        <TicketDetail
          ticket={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
      {showForm && <TicketForm onClose={() => setShowForm(false)} />}
    </div>
  );
}

/* ------------------------------ Tickets ------------------------------ */

function TicketsSection({
  tickets,
  loading,
  error,
  onSelect,
  onAdd,
}: {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
  onSelect: (t: Ticket) => void;
  onAdd: () => void;
}) {
  const [filter, setFilter] = useState<"todos" | "facturado" | "pendiente">("todos");
  const [query, setQuery] = useState("");

  const currentMonth = todayISO().slice(0, 7);
  const monthTickets = tickets.filter((t) => t.ticketDate.startsWith(currentMonth));
  const monthPending = monthTickets.filter((t) => t.status === "pendiente");
  const monthPendingTotal = monthPending.reduce((s, t) => s + t.amount, 0);
  const monthDone = monthTickets.filter((t) => t.status === "facturado");
  const monthDoneTotal = monthDone.reduce((s, t) => s + t.amount, 0);
  const allPending = tickets.filter((t) => t.status === "pendiente");

  const visible = tickets.filter((t) => {
    if (filter !== "todos" && t.status !== filter) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      t.store.toLowerCase().includes(q) ||
      t.folio.toLowerCase().includes(q) ||
      (t.invoiceFolio ?? "").toLowerCase().includes(q)
    );
  });

  const groups = useMemo(() => {
    const map = new Map<string, Ticket[]>();
    for (const t of visible) {
      const key = t.ticketDate.slice(0, 7);
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [visible]);

  return (
    <div>
      <section aria-label="Resumen del mes" className="pt-6">
        <p className="text-sm text-[var(--dim)]">{monthLabel(currentMonth)}</p>
        <p className="mt-1 text-base">Pendiente por facturar este mes</p>
        <p className="font-display text-5xl font-semibold leading-tight">
          {money(monthPendingTotal)}
        </p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-[var(--warn-soft)] px-3 py-1 text-[var(--warn)]">
            {monthPending.length} pendiente{monthPending.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-[var(--accent)]">
            {monthDone.length} facturado{monthDone.length === 1 ? "" : "s"} ·{" "}
            {money(monthDoneTotal)}
          </span>
          {allPending.length > monthPending.length && (
            <span className="rounded-full bg-[var(--surface-alt)] px-3 py-1 text-[var(--dim)]">
              {allPending.length} pendientes en total
            </span>
          )}
        </div>
      </section>

      <button
        type="button"
        onClick={onAdd}
        className="mt-6 w-full rounded-[var(--radius)] bg-[var(--accent)] px-4 py-3 text-base font-semibold text-white"
      >
        + Agregar ticket
      </button>

      <div className="mt-5">
        <label htmlFor="buscar" className="sr-only">
          Buscar por tienda o folio
        </label>
        <input
          id="buscar"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por tienda o folio…"
          className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-base"
        />
      </div>

      <div className="mt-3 flex gap-2" role="group" aria-label="Filtrar por estado">
        {(
          [
            ["todos", "Todos"],
            ["pendiente", "Pendientes"],
            ["facturado", "Facturados"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`rounded-full px-4 py-2 text-sm font-medium ${
              filter === key
                ? "bg-[var(--text)] text-[var(--bg)]"
                : "bg-[var(--surface)] text-[var(--dim)] border border-[var(--border)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <p className="mt-8 text-[var(--dim)]">Cargando tickets…</p>}
      {error && (
        <p className="mt-8 text-[var(--danger)]">
          No se pudieron cargar los tickets. {error}
        </p>
      )}
      {!loading && !error && visible.length === 0 && (
        <p className="mt-8 text-[var(--dim)]">
          {tickets.length === 0
            ? "Todavía no hay tickets. Agrega el primero con el botón de arriba."
            : "Ningún ticket coincide con ese filtro o búsqueda."}
        </p>
      )}

      {groups.map(([key, items]) => {
        const total = items.reduce((s, t) => s + t.amount, 0);
        return (
          <section key={key} aria-label={monthLabel(key)} className="mt-7">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-lg font-semibold">
                {monthLabel(key)}
              </h2>
              <span className="text-sm text-[var(--dim)]">{money(total)}</span>
            </div>
            <ul className="mt-2 divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
              {items.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(t)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                    aria-label={`Ver detalle de ${t.store}, folio ${t.folio}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium">
                        {t.store}
                      </span>
                      <span className="block text-sm text-[var(--dim)]">
                        {fmtDate(t.ticketDate)} · Folio {t.folio}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="font-display block text-base font-semibold">
                        {money(t.amount)}
                      </span>
                      <span
                        className={`text-xs font-medium ${
                          t.status === "facturado"
                            ? "text-[var(--accent)]"
                            : "text-[var(--warn)]"
                        }`}
                      >
                        {t.status === "facturado" ? "Facturado" : "Pendiente"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* --------------------------- Detalle ticket --------------------------- */

function Overlay({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-black/45 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-[var(--surface)] p-5 pb-safe sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-full bg-[var(--surface-alt)] px-3 py-1.5 text-sm"
          >
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <span className="text-sm text-[var(--dim)]">{label}</span>
      <span className="text-right text-base font-medium break-all">{value}</span>
    </div>
  );
}

function TicketDetail({
  ticket,
  onClose,
}: {
  ticket: Ticket;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(ticket.status);
  const [invoiceFolio, setInvoiceFolio] = useState(ticket.invoiceFolio ?? "");
  const [invoiceDate, setInvoiceDate] = useState(ticket.invoiceDate ?? todayISO());
  const [formError, setFormError] = useState<string | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["tickets"] });

  const update = useMutation({
    mutationFn: async () =>
      await api.updateTicket({
        id: ticket.id,
        status,
        invoiceFolio: status === "facturado" ? invoiceFolio.trim() || null : null,
        invoiceDate: status === "facturado" ? invoiceDate || null : null,
      }),
    onSuccess: () => {
      invalidate();
      setEditing(false);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  const del = useMutation({
    mutationFn: async () => await api.deleteTicket({ id: ticket.id }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <Overlay title={ticket.store} onClose={onClose}>
      <div className="divide-y divide-[var(--border)]">
        <Row label="Fecha del ticket" value={fmtDate(ticket.ticketDate)} />
        <Row label="Folio del ticket" value={ticket.folio} />
        <Row label="Monto" value={money(ticket.amount)} />
        <Row
          label="Estado"
          value={ticket.status === "facturado" ? "Facturado" : "Pendiente"}
        />
        <Row label="Uso de CFDI" value={usoCfdi(ticket)} />
        {ticket.code && <Row label="Código de facturación" value={ticket.code} />}
        {ticket.status === "facturado" && (
          <>
            <Row label="Folio de factura" value={ticket.invoiceFolio ?? "—"} />
            <Row label="Fecha de factura" value={fmtDate(ticket.invoiceDate)} />
          </>
        )}
        {ticket.note && <Row label="Nota" value={ticket.note} />}
      </div>

      {ticket.photoUrl && (
        <div className="mt-4">
          <p className="mb-2 text-sm text-[var(--dim)]">Foto del ticket</p>
          <img
            src={ticket.photoUrl}
            alt={`Foto del ticket de ${ticket.store}, folio ${ticket.folio}`}
            className="w-full rounded-[var(--radius)] border border-[var(--border)]"
          />
        </div>
      )}

      {!editing && !confirmingDelete && (
        <div className="mt-6 space-y-3">
          <button
            type="button"
            onClick={() => {
              setStatus(ticket.status);
              setInvoiceFolio(ticket.invoiceFolio ?? "");
              setInvoiceDate(ticket.invoiceDate ?? todayISO());
              setEditing(true);
            }}
            className="w-full rounded-[var(--radius)] bg-[var(--accent)] px-4 py-3 font-semibold text-white"
          >
            {ticket.status === "facturado"
              ? "Editar datos de la factura"
              : "Marcar como facturado"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="w-full rounded-[var(--radius)] border border-[var(--danger)] px-4 py-3 font-semibold text-[var(--danger)]"
          >
            Eliminar este ticket
          </button>
          <p className="text-center text-xs text-[var(--dim)]">
            Eliminar solo borra este ticket de la lista, no la app.
          </p>
        </div>
      )}

      {editing && (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setFormError(null);
            if (status === "facturado" && !invoiceFolio.trim()) {
              setFormError("Escribe el folio de la factura.");
              return;
            }
            update.mutate();
          }}
        >
          <div>
            <label htmlFor="estado" className="mb-1 block text-sm font-medium">
              Estado
            </label>
            <select
              id="estado"
              aria-label="Estado del ticket"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "pendiente" | "facturado")
              }
              className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
            >
              <option value="pendiente">Pendiente</option>
              <option value="facturado">Facturado</option>
            </select>
          </div>
          {status === "facturado" && (
            <>
              <div>
                <label
                  htmlFor="folio-factura"
                  className="mb-1 block text-sm font-medium"
                >
                  Folio de la factura
                </label>
                <input
                  id="folio-factura"
                  aria-label="Folio de la factura"
                  {...FIELDS.updateTicket.invoiceFolio}
                  value={invoiceFolio}
                  onChange={(e) => setInvoiceFolio(e.target.value)}
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                />
              </div>
              <div>
                <label
                  htmlFor="fecha-factura"
                  className="mb-1 block text-sm font-medium"
                >
                  Fecha de la factura
                </label>
                <input
                  id="fecha-factura"
                  aria-label="Fecha de la factura"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5"
                />
              </div>
            </>
          )}
          {formError && <p className="text-sm text-[var(--danger)]">{formError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={update.isPending}
              className="flex-1 rounded-[var(--radius)] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-60"
            >
              {update.isPending ? "Guardando…" : "Guardar"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-3"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {confirmingDelete && (
        <div className="mt-6 rounded-[var(--radius)] border border-[var(--danger)] p-4">
          <p className="font-medium">
            ¿Eliminar el ticket de {ticket.store} por {money(ticket.amount)}?
          </p>
          <p className="mt-1 text-sm text-[var(--dim)]">
            Folio {ticket.folio} · {fmtDate(ticket.ticketDate)}. Esto borra solo
            este ticket y no se puede deshacer.
          </p>
          {formError && (
            <p className="mt-2 text-sm text-[var(--danger)]">{formError}</p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => del.mutate()}
              disabled={del.isPending}
              className="flex-1 rounded-[var(--radius)] bg-[var(--danger)] px-4 py-3 font-semibold text-white disabled:opacity-60"
            >
              {del.isPending ? "Eliminando…" : "Sí, eliminar ticket"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-3"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </Overlay>
  );
}

/* ---------------------------- Formulario ---------------------------- */

function TicketForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [store, setStore] = useState("");
  const [ticketDate, setTicketDate] = useState(todayISO());
  const [folio, setFolio] = useState("");
  const [amount, setAmount] = useState("");
  const [isGasoline, setIsGasoline] = useState(true);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{
    dataBase64: string;
    mimeType: string;
    previewUrl: string;
  } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const add = useMutation({
    mutationFn: async () =>
      await api.addTicket({
        store: store.trim(),
        ticketDate,
        folio: folio.trim(),
        amount: Number(amount),
        status: "pendiente",
        isGasoline,
        code: code.trim() || null,
        note: note.trim() || null,
        photoDataBase64: photo?.dataBase64,
        photoMimeType: photo?.mimeType,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      onClose();
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    setFormError(null);
    try {
      const prepared = await preparePhoto(file);
      if (!prepared) {
        setFormError(
          "No se pudo leer esa foto. Intenta de nuevo o elige otra de la galería.",
        );
        return;
      }
      setPhoto({
        ...prepared,
        previewUrl: URL.createObjectURL(file),
      });
    } finally {
      setPhotoBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!store.trim()) return setFormError("Escribe la tienda o sucursal.");
    if (!folio.trim()) return setFormError("Escribe el folio del ticket.");
    const amt = Number(amount);
    if (!amount || Number.isNaN(amt) || amt <= 0)
      return setFormError("Escribe el monto del ticket.");
    if (!ticketDate) return setFormError("Elige la fecha del ticket.");
    add.mutate();
  }

  const inputCls =
    "w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5";
  const labelCls = "mb-1 block text-sm font-medium";

  return (
    <Overlay title="Agregar ticket" onClose={onClose}>
      <form className="space-y-4" onSubmit={submit}>
        <div>
          <span className={labelCls}>Foto del ticket (opcional)</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="flex-1 rounded-[var(--radius)] border border-[var(--border)] px-3 py-2.5 font-medium"
            >
              Tomar foto
            </button>
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              className="flex-1 rounded-[var(--radius)] border border-[var(--border)] px-3 py-2.5 font-medium"
            >
              Elegir de galería
            </button>
          </div>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label="Tomar foto del ticket con la cámara"
            onChange={onPhoto}
          />
          <input
            ref={galleryRef}
            type="file"
            accept="image/*,.heic,.heif"
            className="hidden"
            aria-label="Elegir foto del ticket de la galería"
            onChange={onPhoto}
          />
          {photoBusy && (
            <p className="mt-2 text-sm text-[var(--dim)]">Preparando la foto…</p>
          )}
          {photo && (
            <img
              src={photo.previewUrl}
              alt="Vista previa de la foto del ticket"
              className="mt-2 max-h-56 w-full rounded-[var(--radius)] border border-[var(--border)] object-contain"
            />
          )}
          <p className="mt-1 text-xs text-[var(--dim)]">
            Las fotos HEIC del iPhone se convierten a JPEG automáticamente.
          </p>
        </div>

        <div>
          <label htmlFor="tienda" className={labelCls}>
            Tienda o sucursal
          </label>
          <input
            id="tienda"
            {...FIELDS.addTicket.store}
            value={store}
            onChange={(e) => setStore(e.target.value)}
            placeholder="Ej. G500 Mexicaltzingo, Walmart, Oxxo…"
            className={inputCls}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="fecha-ticket" className={labelCls}>
              Fecha
            </label>
            <input
              id="fecha-ticket"
              aria-label="Fecha del ticket"
              type="date"
              value={ticketDate}
              onChange={(e) => setTicketDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="monto" className={labelCls}>
              Monto (MXN)
            </label>
            <input
              id="monto"
              {...FIELDS.addTicket.amount}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="300.00"
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label htmlFor="folio-ticket" className={labelCls}>
            Folio del ticket
          </label>
          <input
            id="folio-ticket"
            aria-label="Folio del ticket"
            {...FIELDS.addTicket.folio}
            value={folio}
            onChange={(e) => setFolio(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="codigo" className={labelCls}>
            Código de facturación (si el ticket lo trae)
          </label>
          <input
            id="codigo"
            aria-label="Código de facturación"
            {...FIELDS.addTicket.code}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <span className={labelCls}>Tipo de gasto</span>
          <div className="flex gap-2" role="group" aria-label="Tipo de gasto">
            <button
              type="button"
              aria-pressed={isGasoline}
              onClick={() => setIsGasoline(true)}
              className={`flex-1 rounded-[var(--radius)] px-3 py-2.5 text-sm font-medium ${
                isGasoline
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "border border-[var(--border)] text-[var(--dim)]"
              }`}
            >
              Gasolina · G03
            </button>
            <button
              type="button"
              aria-pressed={!isGasoline}
              onClick={() => setIsGasoline(false)}
              className={`flex-1 rounded-[var(--radius)] px-3 py-2.5 text-sm font-medium ${
                !isGasoline
                  ? "bg-[var(--text)] text-[var(--bg)]"
                  : "border border-[var(--border)] text-[var(--dim)]"
              }`}
            >
              Otro gasto · G01
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="nota" className={labelCls}>
            Nota (opcional)
          </label>
          <input
            id="nota"
            aria-label="Nota"
            {...FIELDS.addTicket.note}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputCls}
          />
        </div>

        {formError && <p className="text-sm text-[var(--danger)]">{formError}</p>}
        <button
          type="submit"
          disabled={add.isPending || photoBusy}
          className="w-full rounded-[var(--radius)] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-60"
        >
          {add.isPending ? "Guardando…" : "Guardar ticket"}
        </button>
      </form>
    </Overlay>
  );
}

/* --------------------------- Datos fiscales --------------------------- */

function FiscalSection() {
  const queryClient = useQueryClient();
  const profileQ = useQuery({
    queryKey: ["fiscal"],
    queryFn: () => api.getFiscalProfile({}),
  });
  const profile: Profile | null = profileQ.data?.profile ?? null;
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    rfc: "",
    regime: "",
    postalCode: "",
    email: "",
    address: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const save = useMutation({
    mutationFn: async () => await api.updateFiscalProfile(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fiscal"] });
      setEditing(false);
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  async function copyAll() {
    if (!profile) return;
    const text = [
      `Nombre: ${profile.name}`,
      `RFC: ${profile.rfc}`,
      `Régimen: ${profile.regime}`,
      `Código postal: ${profile.postalCode}`,
      `Correo: ${profile.email}`,
      `Domicilio: ${profile.address}`,
      "Uso CFDI: G01 Adquisición de mercancías; gasolina G03 Gastos en general",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const inputCls =
    "w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5";
  const labelCls = "mb-1 block text-sm font-medium";

  return (
    <div className="pt-6">
      <h1 className="font-display text-2xl font-semibold">Datos fiscales</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Los que piden los portales al facturar. Cópialos de aquí y pégalos en el
        portal.
      </p>

      {profileQ.isPending && (
        <p className="mt-6 text-[var(--dim)]">Cargando datos fiscales…</p>
      )}
      {!profileQ.isPending && !profile && !editing && (
        <p className="mt-6 text-[var(--dim)]">
          Aún no hay datos fiscales guardados.
        </p>
      )}

      {profile && !editing && (
        <div className="mt-5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-2">
          <div className="divide-y divide-[var(--border)]">
            <Row label="Nombre" value={profile.name} />
            <Row label="RFC" value={profile.rfc} />
            <Row label="Régimen" value={profile.regime} />
            <Row label="Código postal" value={profile.postalCode} />
            <Row label="Correo" value={profile.email} />
            <Row label="Domicilio" value={profile.address} />
            <Row
              label="Uso de CFDI"
              value="G01 Adquisición de mercancías · Gasolina: G03 Gastos en general"
            />
          </div>
        </div>
      )}

      {profile && !editing && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={copyAll}
            className="flex-1 rounded-[var(--radius)] bg-[var(--accent)] px-4 py-3 font-semibold text-white"
          >
            {copied ? "¡Copiado!" : "Copiar datos fiscales"}
          </button>
          <button
            type="button"
            onClick={() => {
              setForm({
                name: profile.name,
                rfc: profile.rfc,
                regime: profile.regime,
                postalCode: profile.postalCode,
                email: profile.email,
                address: profile.address,
              });
              setEditing(true);
            }}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 font-medium"
          >
            Editar
          </button>
        </div>
      )}

      {(editing || (!profile && !profileQ.isPending)) && (
        <form
          className="mt-5 space-y-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setFormError(null);
            if (
              !form.name.trim() ||
              !form.rfc.trim() ||
              !form.regime.trim() ||
              !form.postalCode.trim() ||
              !form.email.trim() ||
              !form.address.trim()
            ) {
              setFormError("Completa todos los campos.");
              return;
            }
            save.mutate();
          }}
        >
          {(
            [
              ["name", "Nombre o razón social"],
              ["rfc", "RFC"],
              ["regime", "Régimen fiscal"],
              ["postalCode", "Código postal"],
              ["email", "Correo electrónico"],
              ["address", "Domicilio fiscal"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <label htmlFor={`fiscal-${key}`} className={labelCls}>
                {label}
              </label>
              <input
                id={`fiscal-${key}`}
                aria-label={label}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className={inputCls}
              />
            </div>
          ))}
          {formError && <p className="text-sm text-[var(--danger)]">{formError}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={save.isPending}
              className="flex-1 rounded-[var(--radius)] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-60"
            >
              {save.isPending ? "Guardando…" : "Guardar datos fiscales"}
            </button>
            {profile && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-3"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

/* ------------------------------ Portales ------------------------------ */

function PortalsSection() {
  const queryClient = useQueryClient();
  const portalsQ = useQuery({
    queryKey: ["portals"],
    queryFn: () => api.listPortals({}),
  });
  const portals: Portal[] = portalsQ.data?.portals ?? [];
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: async () =>
      await api.addPortal({
        name: name.trim(),
        url: url.trim(),
        username: username.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["portals"] });
      setShowForm(false);
      setName("");
      setUrl("");
      setUsername("");
    },
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  const del = useMutation({
    mutationFn: async (id: number) => await api.deletePortal({ id }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["portals"] }),
    onError: (e) => setFormError(e instanceof Error ? e.message : String(e)),
  });

  const inputCls =
    "w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5";
  const labelCls = "mb-1 block text-sm font-medium";

  return (
    <div className="pt-6">
      <h1 className="font-display text-2xl font-semibold">Portales de facturación</h1>
      <p className="mt-1 text-sm text-[var(--dim)]">
        Entra al portal, captura el ticket con tus datos fiscales y marca el
        ticket como facturado aquí. Por seguridad, las contraseñas no se
        guardan en la app.
      </p>

      {portalsQ.isPending && (
        <p className="mt-6 text-[var(--dim)]">Cargando portales…</p>
      )}

      <ul className="mt-5 space-y-3">
        {portals.map((p) => (
          <li
            key={p.id}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-base font-semibold">{p.name}</p>
                {p.username && (
                  <p className="text-sm text-[var(--dim)]">
                    Usuario: {p.username}
                  </p>
                )}
                {p.note && <p className="text-sm text-[var(--dim)]">{p.note}</p>}
              </div>
              <button
                type="button"
                onClick={() => del.mutate(p.id)}
                aria-label={`Eliminar portal ${p.name}`}
                className="shrink-0 rounded-full bg-[var(--surface-alt)] px-3 py-1.5 text-sm text-[var(--danger)]"
              >
                Eliminar
              </button>
            </div>
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block break-all text-sm font-medium text-[var(--accent)] underline"
            >
              Abrir portal
            </a>
          </li>
        ))}
      </ul>

      {!portalsQ.isPending && portals.length === 0 && (
        <p className="mt-4 text-[var(--dim)]">Todavía no hay portales guardados.</p>
      )}

      {formError && <p className="mt-3 text-sm text-[var(--danger)]">{formError}</p>}

      {!showForm ? (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="mt-5 w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 font-semibold"
        >
          + Agregar portal
        </button>
      ) : (
        <form
          className="mt-5 space-y-4 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setFormError(null);
            if (!name.trim()) return setFormError("Escribe el nombre del portal.");
            if (!url.trim()) return setFormError("Escribe la dirección del portal.");
            add.mutate();
          }}
        >
          <div>
            <label htmlFor="portal-nombre" className={labelCls}>
              Nombre
            </label>
            <input
              id="portal-nombre"
              {...FIELDS.addPortal.name}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej. Walmart, Oxxo, 3B…"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="portal-url" className={labelCls}>
              Dirección (URL)
            </label>
            <input
              id="portal-url"
              {...FIELDS.addPortal.url}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="portal-usuario" className={labelCls}>
              Usuario (opcional, sin contraseña)
            </label>
            <input
              id="portal-usuario"
              aria-label="Usuario del portal"
              {...FIELDS.addPortal.username}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={add.isPending}
              className="flex-1 rounded-[var(--radius)] bg-[var(--accent)] px-4 py-3 font-semibold text-white disabled:opacity-60"
            >
              {add.isPending ? "Guardando…" : "Guardar portal"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-[var(--radius)] border border-[var(--border)] px-4 py-3"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
