Add-Type -AssemblyName System.Drawing

$green = [System.Drawing.ColorTranslator]::FromHtml('#245D43')
$pale = [System.Drawing.ColorTranslator]::FromHtml('#DDE9D7')
$land = [System.Drawing.ColorTranslator]::FromHtml('#83A982')
$cream = [System.Drawing.ColorTranslator]::FromHtml('#F6F3EA')

function Draw-PrithviMark([System.Drawing.Graphics]$g, [float]$x, [float]$y, [float]$size, [bool]$mono = $false) {
  $state = $g.Save()
  $g.TranslateTransform($x, $y)
  $g.ScaleTransform($size / 512, $size / 512)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $outline = if ($mono) { [System.Drawing.Brushes]::White } else { [System.Drawing.SolidBrush]::new($green) }
  $interior = if ($mono) { [System.Drawing.Brushes]::White } else { [System.Drawing.SolidBrush]::new($pale) }
  $landBrush = if ($mono) { [System.Drawing.Brushes]::Black } else { [System.Drawing.SolidBrush]::new($land) }
  $stemColor = if ($mono) { [System.Drawing.Color]::Black } else { $green }
  $g.FillEllipse($outline, 30, 30, 452, 452)
  if (-not $mono) { $g.FillEllipse($interior, 45, 45, 422, 422) }
  $g.SetClip([System.Drawing.RectangleF]::new(45, 45, 422, 422))
  $continents = @(
    @([System.Drawing.Point]::new(95,170),[System.Drawing.Point]::new(130,118),[System.Drawing.Point]::new(195,105),[System.Drawing.Point]::new(220,137),[System.Drawing.Point]::new(198,172),[System.Drawing.Point]::new(210,205),[System.Drawing.Point]::new(175,226),[System.Drawing.Point]::new(153,270),[System.Drawing.Point]::new(120,244),[System.Drawing.Point]::new(105,205)),
    @([System.Drawing.Point]::new(308,105),[System.Drawing.Point]::new(365,116),[System.Drawing.Point]::new(404,154),[System.Drawing.Point]::new(386,184),[System.Drawing.Point]::new(351,192),[System.Drawing.Point]::new(344,229),[System.Drawing.Point]::new(316,253),[System.Drawing.Point]::new(291,225),[System.Drawing.Point]::new(300,188),[System.Drawing.Point]::new(275,157)),
    @([System.Drawing.Point]::new(211,252),[System.Drawing.Point]::new(252,239),[System.Drawing.Point]::new(282,261),[System.Drawing.Point]::new(278,302),[System.Drawing.Point]::new(260,339),[System.Drawing.Point]::new(246,385),[System.Drawing.Point]::new(223,368),[System.Drawing.Point]::new(216,327),[System.Drawing.Point]::new(194,291))
  )
  foreach ($shape in $continents) { $g.FillPolygon($landBrush, $shape) }
  $pen = [System.Drawing.Pen]::new($stemColor, 13)
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round; $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($pen, 256, 455, 256, 334)
  $g.DrawLine($pen, 256, 407, 213, 363)
  $g.DrawLine($pen, 256, 386, 300, 342)
  $leafBrush = if ($mono) { [System.Drawing.Brushes]::Black } else { [System.Drawing.SolidBrush]::new($green) }
  $g.FillPolygon($leafBrush, @([System.Drawing.Point]::new(211,363),[System.Drawing.Point]::new(164,352),[System.Drawing.Point]::new(177,395),[System.Drawing.Point]::new(216,407)))
  $g.FillPolygon($leafBrush, @([System.Drawing.Point]::new(300,342),[System.Drawing.Point]::new(347,330),[System.Drawing.Point]::new(334,374),[System.Drawing.Point]::new(295,390)))
  $g.FillPolygon($leafBrush, @([System.Drawing.Point]::new(256,374),[System.Drawing.Point]::new(226,330),[System.Drawing.Point]::new(256,304),[System.Drawing.Point]::new(286,330)))
  $pen.Dispose()
  $g.ResetClip()
  $g.Restore($state)
  if (-not $mono) { $outline.Dispose(); $interior.Dispose(); $landBrush.Dispose(); $leafBrush.Dispose() }
}

function Save-BrandPng([string]$path, [int]$size, [string]$background, [bool]$mono = $false, [float]$markSize = 512) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bitmap)
  $g.Clear([System.Drawing.Color]::Transparent)
  if ($background -ne 'transparent') { $g.Clear([System.Drawing.ColorTranslator]::FromHtml($background)) }
  $offset = ($size - $markSize) / 2
  Draw-PrithviMark $g $offset $offset $markSize $mono
  $bitmap.Save((Join-Path (Get-Location) $path), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bitmap.Dispose()
}

Save-BrandPng 'assets/branding/prithvi-mark.png' 512 'transparent'
Save-BrandPng 'assets/branding/prithvi-icon.png' 1024 '#F6F3EA' $false 760
Save-BrandPng 'assets/branding/prithvi-android-foreground.png' 1024 'transparent' $false 760
Save-BrandPng 'assets/branding/prithvi-android-monochrome.png' 1024 'transparent' $true 760
Save-BrandPng 'assets/branding/prithvi-splash.png' 1024 '#F6F3EA' $false 570
