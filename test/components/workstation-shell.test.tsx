import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { WorkstationShell } from "@/components/WorkstationShell";

const ownerRoutes = ["/home", "/customers", "/conversations", "/tasks", "/agents", "/analytics"];
const operationRoutes = [
  "/operations/imports",
  "/operations/campaigns",
  "/operations/deliveries",
  "/operations/integrations",
  "/operations/live-operations",
  "/operations/audit",
];

afterEach(cleanup);

test("renders the owner navigation, operations drawer, and Ask Vectis surface", async () => {
  render(
    <WorkstationShell>
      <h1>Page content</h1>
    </WorkstationShell>,
  );

  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/home");
  for (const route of ownerRoutes) {
    expect(screen.getByRole("link", { name: new RegExp(route.slice(1), "i") })).toHaveAttribute(
      "href",
      route,
    );
  }

  const operations = screen.getByRole("button", { name: /operations/i });
  expect(operations).toBeVisible();
  await userEvent.setup().click(operations);
  for (const route of operationRoutes) {
    expect(
      screen.getByRole("link", {
        name: new RegExp((route.split("/").at(-1) ?? "").replaceAll("-", " "), "i"),
      }),
    ).toHaveAttribute("href", route);
  }

  expect(screen.getByRole("textbox", { name: /ask vectis/i })).toBeVisible();
  const askButton = screen.getByRole("button", { name: /send to vectis/i });
  expect(askButton).toBeDisabled();
  expect(screen.getByText(/backend command service is not configured/i)).toBeVisible();
});

test("does not expose the retired probe in product UI", () => {
  render(
    <WorkstationShell>
      <h1>Page content</h1>
    </WorkstationShell>,
  );
  expect(screen.queryByText(/probe/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /record probe/i })).not.toBeInTheDocument();
});
