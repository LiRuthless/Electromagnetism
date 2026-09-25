function build_all()
%BUILD_ALL 一键构建全部 Simulink 模型（em_field_check + em_track_sim）。
root = fileparts(mfilename('fullpath'));
addpath(root, fullfile(root,'track_lib'), fullfile(root,'geom'), ...
    fullfile(root,'field'), fullfile(root,'sensor'), fullfile(root,'control'), ...
    fullfile(root,'blocks'), fullfile(root,'selfcheck'), fullfile(root,'demo'));
init;                  % 默认参数 + 默认赛道，注入 base 工作区
build_em_field_check;
build_em_track_sim;
fprintf('[build_all] 全部模型构建完成。\n');
end
