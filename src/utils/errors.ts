export function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const anyErr = error as {
      response?: { data?: { message?: string } };
      message?: string;
    };
    if (anyErr.response?.data?.message) return anyErr.response.data.message;
    if (anyErr.message) return anyErr.message;
  }
  return String(error);
}
