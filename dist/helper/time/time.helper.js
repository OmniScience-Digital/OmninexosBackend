export function getJhbTimestamp() {
    const options = { timeZone: 'Africa/Johannesburg', hour12: false };
    const jhbDate = new Intl.DateTimeFormat('en-GB', {
        ...options,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(new Date());
    const [datePart, timePart] = jhbDate.split(', ');
    const [day, month, year] = datePart.split('/');
    const jhbTimestamp = `${year}-${month}-${day} ${timePart}`;
    return jhbTimestamp;
}
