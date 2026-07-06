import { toast } from "sonner";

export interface ToastData {
  ok: boolean;
  text: string;
  /** When true the toast represents in-flight work: it stays until replaced. */
  pending?: boolean;
}

const TOAST_ID = "dashboard-action";

export function showDashboardToast(data: ToastData) {
  if (data.pending) {
    toast.loading(data.text, { id: TOAST_ID });
    return;
  }
  if (data.ok) {
    toast.success(data.text, { id: TOAST_ID });
    return;
  }
  toast.error(data.text, { id: TOAST_ID });
}

export { toast };
