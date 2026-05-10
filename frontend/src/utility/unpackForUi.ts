export function unpackTicketForUI(packedStr: string, normalMax: number) {
    try {
        const packed = BigInt(packedStr);
        const numbers: number[] = [];
        let bonus = 0;
        for (let i = 0; i <= normalMax; i++) if ((packed & (1n << BigInt(i))) !== 0n) numbers.push(i);
        for (let i = normalMax + 1; i <= 63; i++) {
            if ((packed & (1n << BigInt(i))) !== 0n) { bonus = i - normalMax; break; }
        }
        return { numbers, bonus };
    } catch (e) { return { numbers: [0, 0, 0, 0, 0], bonus: 0 }; }
}

export const generateTicket = (normalMax: number, specialMax: number) => {
    const normals = new Set<number>();
    while (normals.size < 5) normals.add(Math.floor(Math.random() * normalMax) + 1);
    return { normals: Array.from(normals).sort((a, b) => a - b), bonus: Math.floor(Math.random() * specialMax) + 1 };
};