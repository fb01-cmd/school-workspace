import { redirect } from "next/navigation";

export default function Home() {
  // We just redirect the root URL to the login page for now.
  redirect("/login");
}
