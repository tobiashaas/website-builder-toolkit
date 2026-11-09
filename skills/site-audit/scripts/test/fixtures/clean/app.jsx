export function Visit() {
  const slots = useSlots();
  return (
    <section className="grid gap-6 p-6">
      <h2 className="text-2xl font-semibold">Book a workshop visit</h2>
      <p className="text-base">Visits run Tuesday to Thursday, 9:00 to 16:00.</p>
      <div className="animate-pulse skeleton h-4" />
      <button className="rounded-md px-4 py-2 transition-colors focus-visible:ring-2 outline-none">Choose a slot</button>
      {slots.length > 0 && <p>{slots.length} slots free this week</p>}
    </section>
  );
}
