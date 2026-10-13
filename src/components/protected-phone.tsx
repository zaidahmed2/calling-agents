"use client";

import styles from "@/components/protected-phone.module.css";

export default function ProtectedPhone({ phone, callLink = true }: { phone: string; callLink?: boolean }) {
	const blockCopy = (event: { preventDefault: () => void }) => event.preventDefault();

	return <span
		className={styles.phone}
		onCopy={blockCopy}
		onCut={blockCopy}
		onContextMenu={blockCopy}
		onSelect={blockCopy}
		onDragStart={blockCopy}
		onKeyDown={(event) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") event.preventDefault();
		}}
		aria-label="Phone number"
	>{callLink ? <a href={`tel:${phone}`} draggable={false}>{phone}</a> : phone}</span>;
}
