# Script de configuración para P2P Notes
# Ejecutar como Administrador en PowerShell

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  P2P Notes - Configuración de Red" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Obtener IP local
Write-Host "Detectando tu dirección IP local..." -ForegroundColor Yellow
$ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.InterfaceAlias -notmatch "Loopback" -and $_.IPAddress -notmatch "169.254"}).IPAddress | Select-Object -First 1

if ($ipAddress) {
    Write-Host "✅ Tu IP local es: " -NoNewline -ForegroundColor Green
    Write-Host $ipAddress -ForegroundColor White -BackgroundColor DarkGreen
    Write-Host ""
    Write-Host "📋 En la otra computadora, abre:" -ForegroundColor Cyan
    Write-Host "   http://$ipAddress:3000" -ForegroundColor White -BackgroundColor DarkBlue
} else {
    Write-Host "❌ No se pudo detectar la IP local" -ForegroundColor Red
    Write-Host "   Ejecuta manualmente: ipconfig" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🔥 Configurando regla de firewall..." -ForegroundColor Yellow

# Eliminar regla existente si existe
$existingRule = Get-NetFirewallRule -DisplayName "P2P Notes" -ErrorAction SilentlyContinue
if ($existingRule) {
    Write-Host "   Eliminando regla anterior..." -ForegroundColor Gray
    Remove-NetFirewallRule -DisplayName "P2P Notes"
}

# Crear nueva regla
try {
    New-NetFirewallRule -DisplayName "P2P Notes" `
                        -Direction Inbound `
                        -Protocol TCP `
                        -LocalPort 3000 `
                        -Action Allow `
                        -Profile Any | Out-Null
    Write-Host "✅ Firewall configurado correctamente" -ForegroundColor Green
} catch {
    Write-Host "❌ Error configurando firewall: $_" -ForegroundColor Red
    Write-Host "   Intenta ejecutar como Administrador" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Instrucciones:" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "1. En esta computadora, ejecuta: npm start" -ForegroundColor White
Write-Host "2. Abre el navegador en: http://localhost:3000" -ForegroundColor White
if ($ipAddress) {
    Write-Host "3. En la otra PC, abre: http://$ipAddress:3000" -ForegroundColor White
}
Write-Host "4. Presiona F12 en ambos navegadores para ver logs" -ForegroundColor White
Write-Host "5. Crea una nota y verifica la sincronización" -ForegroundColor White
Write-Host ""
Write-Host "🐛 Si hay problemas, lee: TROUBLESHOOTING.md" -ForegroundColor Yellow
Write-Host ""

# Preguntar si iniciar el servidor
$response = Read-Host "¿Quieres iniciar el servidor ahora? (s/n)"
if ($response -eq "s" -or $response -eq "S") {
    Write-Host ""
    Write-Host "🚀 Iniciando servidor..." -ForegroundColor Green
    Write-Host ""
    npm start
} else {
    Write-Host ""
    Write-Host "✅ Configuración completa. Ejecuta 'npm start' cuando estés listo." -ForegroundColor Green
}
