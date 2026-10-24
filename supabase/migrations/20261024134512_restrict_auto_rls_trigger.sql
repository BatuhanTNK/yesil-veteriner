-- This event trigger is managed by the project owner, never by site visitors.
-- Preserve automatic RLS while removing unnecessary public function execution.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
