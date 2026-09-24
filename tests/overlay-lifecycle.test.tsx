import { afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();
const React = await import("react");
const { render, cleanup, fireEvent, waitFor } = await import("@testing-library/react");
const D = await import("../src/components/ui/dialog");
const S = await import("../src/components/ui/sheet");
const A = await import("../src/components/ui/alert-dialog");
afterEach(cleanup);
const kinds = [
  { name: "Dialog", Root: D.Dialog, Content: D.DialogContent, Title: D.DialogTitle },
  { name: "Sheet", Root: S.Sheet, Content: S.SheetContent, Title: S.SheetTitle },
  {
    name: "AlertDialog",
    Root: A.AlertDialog,
    Content: A.AlertDialogContent,
    Title: A.AlertDialogTitle,
  },
];
for (const { name, Root, Content, Title } of kinds) {
  test(`${name}: repeated close and route unmount release portals and body locks`, async () => {
    let clicks = 0;
    function Page({ open, mounted = true }: { open: boolean; mounted?: boolean }) {
      return (
        <>
          <button onClick={() => clicks++}>BottomNav</button>
          {mounted && (
            <Root open={open}>
              <Content aria-describedby={undefined}>
                <Title>Diagnostic modal</Title>
                <button>Action</button>
              </Content>
            </Root>
          )}
        </>
      );
    }
    const initialPointer = document.body.style.pointerEvents;
    const initialOverflow = document.body.style.overflow;
    const ui = render(<Page open={false} />);
    for (let i = 0; i < 10; i++) {
      ui.rerender(<Page open />);
      await waitFor(() =>
        expect(document.querySelector('[role="dialog"],[role="alertdialog"]')).not.toBeNull(),
      );
      ui.rerender(<Page open={false} />);
      await waitFor(() =>
        expect(document.querySelector('[data-state="open"], [data-state="closed"]')).toBeNull(),
      );
      expect(document.body.style.pointerEvents).toBe(initialPointer);
      expect(document.body.style.overflow).toBe(initialOverflow);
      expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
      fireEvent.click(ui.getByText("BottomNav"));
    }
    ui.rerender(<Page open />);
    ui.rerender(<Page open mounted={false} />);
    await waitFor(() =>
      expect(document.querySelector('[role="dialog"],[role="alertdialog"]')).toBeNull(),
    );
    expect(document.body.style.pointerEvents).toBe(initialPointer);
    expect(document.body.style.overflow).toBe(initialOverflow);
    expect(document.body.hasAttribute("data-scroll-locked")).toBe(false);
    expect(clicks).toBe(10);
  });
}

const { overlayHeightFallback, watchOverlayViewport } =
  await import("../src/lib/use-overlay-viewport");
const { spyOn } = await import("bun:test");
test("fallback preserves percentage caps and rem gutters", () => {
  expect(overlayHeightFallback("p-0 max-h-[90vh]", 800)).toBe("720px");
  expect(overlayHeightFallback("max-h-[85vh]", 800)).toBe("680px");
  expect(overlayHeightFallback("max-h-[calc(100dvh-2rem)]", 800)).toBe("calc(800px - 2rem)");
  expect(overlayHeightFallback("max-h-[calc(100dvh-1rem)]", 800)).toBe("calc(800px - 1rem)");
  expect(overlayHeightFallback("max-h-[200px]", 800)).toBeNull();
  expect(overlayHeightFallback("max-h-[90vh]", 0)).toBeNull();
});
test("collapsed CSS viewport uses measured height, follows resize and releases listeners", () => {
  const node = document.createElement("div");
  node.className = "max-h-[90vh]";
  document.body.append(node);
  let cssHeight = "0px";
  const styleSpy = spyOn(globalThis, "getComputedStyle").mockImplementation((() => ({
    maxHeight: cssHeight,
  })) as any);
  const originalHeight = window.innerHeight;
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 800, writable: true });
  const originalViewport = window.visualViewport;
  Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
  const dispose = watchOverlayViewport(node);
  try {
    expect(node.style.maxHeight).toBe("720px");
    window.innerHeight = 600;
    window.dispatchEvent(new Event("resize"));
    expect(node.style.maxHeight).toBe("540px");
    cssHeight = "540px";
    window.dispatchEvent(new Event("resize"));
    expect(node.style.maxHeight).toBe(""); // native CSS recovered
    cssHeight = "0px";
    window.dispatchEvent(new Event("resize"));
    expect(node.style.maxHeight).toBe("540px");
    dispose();
    expect(node.style.maxHeight).toBe("");
    window.innerHeight = 900;
    window.dispatchEvent(new Event("resize"));
    expect(node.style.maxHeight).toBe("");
  } finally {
    dispose();
    styleSpy.mockRestore();
    node.remove();
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: originalHeight,
      writable: true,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: originalViewport,
    });
  }
});
test("healthy CSS max-height is not overridden", () => {
  const node = document.createElement("div");
  node.className = "max-h-[90vh]";
  const spy = spyOn(globalThis, "getComputedStyle").mockImplementation((() => ({
    maxHeight: "720px",
  })) as any);
  try {
    const dispose = watchOverlayViewport(node);
    expect(node.style.maxHeight).toBe("");
    dispose();
  } finally {
    spy.mockRestore();
  }
});

test("real portalled Dialog receives fallback during mount and releases it on close", () => {
  const original = globalThis.getComputedStyle;
  const spy = spyOn(globalThis, "getComputedStyle").mockImplementation((node, pseudo) => {
    const style = original(node, pseudo);
    if (node.getAttribute("role") !== "dialog") return style;
    return new Proxy(style, {
      get(target, key) {
        return key === "maxHeight" ? "0px" : Reflect.get(target, key);
      },
    });
  });
  try {
    const ui = render(
      <D.Dialog open>
        <D.DialogContent aria-describedby={undefined} className="max-h-[90vh]">
          <D.DialogTitle>Viewport test</D.DialogTitle>
        </D.DialogContent>
      </D.Dialog>,
    );
    const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(parseFloat(panel.style.maxHeight)).toBeGreaterThan(0);
    ui.unmount();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(panel.style.maxHeight).toBe("");
  } finally {
    spy.mockRestore();
  }
});
