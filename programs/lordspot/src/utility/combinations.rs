pub fn choose(n: u64, k: u64) -> Option<u64> {
    if k > n { return Some(0); }
    if k == 0 || k == n { return Some(1); }

    // Safety check: if n is 0, we already handled it with k > n or k == 0
    // But for clarity, we start our loop logic here
    let mut out: u64 = 1;

    for d in 1..=k {
        out = out.checked_mul(n.checked_sub(d)?.checked_add(1)?)?
            .checked_div(d)?;
    }

    Some(out)
}