$path = 'c:\projects\deepwatch\scripts\example-payload\kalshi.json'
$t = [System.IO.File]::ReadAllText($path)
$json = $t | ConvertFrom-Json

# For one event (26JUN1605), how many markets per series?
$event = 'KXBTC-26JUN1605'
$eventD = 'KXBTCD-26JUN1605'

$kxbtcEvent = $json | Where-Object { $_.externalEventId -eq $event -and $_.outcome -eq 'YES' }
$kxbtcDEvent = $json | Where-Object { $_.externalEventId -eq $eventD -and $_.outcome -eq 'YES' }

Write-Output "=== KXBTC event $event (YES rows only) ==="
Write-Output "Total: $($kxbtcEvent.Count)"
$kxbtcEvent | Group-Object -Property marketType | ForEach-Object {
  "  $($_.Name): $($_.Count)"
}

Write-Output ""
Write-Output "=== KXBTCD event $eventD (YES rows only) ==="
Write-Output "Total: $($kxbtcDEvent.Count)"
$kxbtcDEvent | Group-Object -Property marketType | ForEach-Object {
  "  $($_.Name): $($_.Count)"
}

Write-Output ""
Write-Output "=== Combined per event ==="
$total = $kxbtcEvent.Count + $kxbtcDEvent.Count
$upDown = ($kxbtcEvent | Where-Object { $_.marketType -eq 'UP_DOWN' }).Count +
          ($kxbtcDEvent | Where-Object { $_.marketType -eq 'UP_DOWN' }).Count
$range = ($kxbtcEvent | Where-Object { $_.marketType -eq 'RANGE' }).Count +
         ($kxbtcDEvent | Where-Object { $_.marketType -eq 'RANGE' }).Count
Write-Output "Total YES rows: $total"
Write-Output "  UP_DOWN: $upDown ($([math]::Round(($upDown/$total)*100, 1))%)"
Write-Output "  RANGE: $range ($([math]::Round(($range/$total)*100, 1))%)"
