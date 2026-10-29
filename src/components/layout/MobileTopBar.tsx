"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { SidebarNav } from "@/components/layout/SidebarNav";
import { UserMenu, type MenuUser } from "@/components/layout/UserMenu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface MobileTopBarProps {
  user: MenuUser;
}

/**
 * Barra superior no MOBILE/tablet (< lg), onde a sidebar fixa não cabe (043).
 *
 * Leva o botão de menu (abre o mesmo `SidebarNav` num drawer à esquerda), a
 * marca e o menu do usuário — antes tudo isso vivia no TopNav.
 */
export function MobileTopBar({ user }: MobileTopBarProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b bg-card px-3 lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(true)} aria-label="Abrir menu">
          <Menu aria-hidden />
        </Button>

        <SheetContent side="left" className="w-64 gap-0 p-0 sm:max-w-64">
          <SheetHeader className="flex-row items-center gap-2 py-2.5 pr-12">
            <SheetTitle className="flex min-w-0 items-center gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border bg-primary">
                <Image
                  src="/logo_imperatriz.png"
                  alt=""
                  width={24}
                  height={24}
                  className="h-full w-full object-contain"
                />
              </span>
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-sm font-semibold">Imperatriz</span>
                <span className="block text-[10px] text-muted-foreground">SRS</span>
              </span>
            </SheetTitle>
          </SheetHeader>

          <nav aria-label="Navegação principal" className="min-h-0 flex-1 overflow-y-auto p-2">
            <SidebarNav role={user.role} pathname={pathname} onNavigate={() => setOpen(false)} />
          </nav>

          <div className="border-t p-2">
            <UserMenu user={user} showLabel />
          </div>
        </SheetContent>
      </Sheet>

      <Link href="/" aria-label="Ir para a página inicial" className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded border bg-primary">
          <Image
            src="/logo_imperatriz.png"
            alt=""
            width={24}
            height={24}
            className="h-full w-full object-contain"
          />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-semibold">Imperatriz</span>
          <span className="block text-[10px] text-muted-foreground">SRS</span>
        </span>
      </Link>

      <div className="ml-auto flex items-center gap-1">
        <UserMenu user={user} showLabel={false} />
      </div>
    </header>
  );
}
