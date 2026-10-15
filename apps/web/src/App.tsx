import { Routes, Route } from 'react-router-dom';

/**
 * Root application component.
 * Routes are added in Phase 12 (TASK-077 through TASK-102).
 * This skeleton satisfies TASK-006 and the TASK-006 Vitest test.
 */
export default function App(): React.ReactElement {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <main className="flex min-h-screen items-center justify-center p-4">
            <div className="text-center">
              <h1 className="text-2xl font-bold">FakeNews Intervention Platform</h1>
              <p className="mt-2 text-gray-500">Loading…</p>
            </div>
          </main>
        }
      />
    </Routes>
  );
}
