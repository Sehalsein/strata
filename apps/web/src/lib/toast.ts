import { toast as sonnerToast } from "sonner";

export const toast = {
  success: (msg: string, opts?: { description?: string }) =>
    sonnerToast.success(msg, opts),
  error: (msg: string, opts?: { description?: string }) =>
    sonnerToast.error(msg, opts),
  info: (msg: string, opts?: { description?: string }) =>
    sonnerToast(msg, opts),
};

export const errorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Something went wrong";
};
