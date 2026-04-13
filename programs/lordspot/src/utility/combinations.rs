// # init_lordspot_handler
pub fn choose(n: u64, k: u64) -> Option<u64> {
    if k > n {
        return Some(0);
    }
    if k == 0 || k == n {
        return Some(1);
    }

    let mut out: u64 = 1;

    for d in 1..=k {
        let term = n.checked_sub(d)?.checked_add(1)?;
        out = out.checked_mul(term)?.checked_div(d)?;
    }

    Some(out)
}