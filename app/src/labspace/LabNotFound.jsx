import { Link } from "react-router";

// Shown when the route names a lab the catalog doesn't have (or there is no
// catalog at all). Previously a persistent toast; an inline page says the same
// thing without hiding in a corner, and gives a way back to the catalog.
export function LabNotFound({ message }) {
  return (
    <div className="lab-not-found">
      <h1>Lab not found</h1>
      <p>{message}</p>
      <p>
        <Link to="/">Back to all labs</Link>
      </p>
    </div>
  );
}
