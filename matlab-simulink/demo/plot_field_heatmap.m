function figFile = plot_field_heatmap(trackName, h)
%PLOT_FIELD_HEATMAP 赛道磁场 |B| 热力图（观测高度 h，默认 75 mm，§5.5 网格批算）。
% 用法：plot_field_heatmap('track_loop_rounded')
% 输出：outputs/heatmap_<赛道名>.png
if nargin < 1, trackName = 'track_loop_rounded'; end
if nargin < 2, h = 0.075; end
ensureRoot();
init(trackName);
TD = evalin('base','TD');
P  = evalin('base','P');

% 网格：赛道包围盒外扩 0.25 m，约 5 mm 分辨率
xs0 = TD.path.pts(:,1); ys0 = TD.path.pts(:,2);
x0 = min(xs0)-0.25; x1 = max(xs0)+0.25;
y0 = min(ys0)-0.25; y1 = max(ys0)+0.25;
dx = 0.005; dy = 0.005;
nx = ceil((x1-x0)/dx); ny = ceil((y1-y0)/dy);
[BX,BY,BZ,BM] = em_computeGrid(TD.wires, TD.mids, TD.dls, P.I, x0, y0, nx, ny, dx, dy, h); %#ok<ASGLU>

fig = figure('Visible','off','Position',[100 100 760 640]);
imagesc([x0+dx/2 x1-dx/2], [y0+dy/2 y1-dy/2], BM*1e6);
set(gca,'YDir','normal'); axis equal tight; hold on;
plot(xs0, ys0, 'w-', 'LineWidth', 1.2);
cb = colorbar; cb.Label.String = '|B| (\muT)';
xlabel('x (m)'); ylabel('y (m)');
title(sprintf('磁场分布 |B|（赛道 %s，观测高度 %d mm，I = %d mA）', ...
    strrep(TD.name,'_','\_'), round(h*1000), round(P.I*1000)));

figFile = fullfile(ensureOutDir(), sprintf('heatmap_%s.png', TD.name));
print(fig, '-dpng', '-r150', figFile);
close(fig);
fprintf('[demo] 热力图已保存：%s\n', figFile);
end

function ensureRoot()
here = fileparts(mfilename('fullpath'));
root = fileparts(here);
if isempty(which('params'))
    addpath(root, fullfile(root,'track_lib'), fullfile(root,'geom'), ...
        fullfile(root,'field'), fullfile(root,'sensor'), fullfile(root,'control'), ...
        fullfile(root,'blocks'), fullfile(root,'selfcheck'), fullfile(root,'demo'));
end
end

function d = ensureOutDir()
here = fileparts(mfilename('fullpath'));
d = fullfile(fileparts(here), 'outputs');
if ~exist(d,'dir'), mkdir(d); end
end
